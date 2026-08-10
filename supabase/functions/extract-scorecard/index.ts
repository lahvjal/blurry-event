/**
 * Extracts a course scorecard into a review-only draft.
 *
 * Required secret: OPENAI_API_KEY
 * Optional secret: SCORECARD_OCR_MODEL (defaults to gpt-5.6)
 *
 * The image is supplied as a base64 data URL for this one request. It is not
 * written to Storage or the database. An event admin must review and save the
 * extracted result through apply_event_scorecard before data changes.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

type Candidate = {
  holes: Array<{ hole: number; par: number }>;
  teeSets: Array<{ name: string; yardages: number[] }>;
  notes: string[];
};

function fail(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: cors });
}

function textFromResponse(payload: any): string {
  if (typeof payload.output_text === 'string') return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function validateCandidate(value: any): Candidate | null {
  if (!value || !Array.isArray(value.holes) || !Array.isArray(value.teeSets)) return null;
  const holes = value.holes.map((hole: any) => ({ hole: Number(hole.hole), par: Number(hole.par) }));
  const teeSets = value.teeSets.map((tee: any) => ({
    name: typeof tee.name === 'string' ? tee.name.trim() : '',
    yardages: Array.isArray(tee.yardages) ? tee.yardages.map(Number) : [],
  }));
  const validHoles = holes.length === 18 && new Set(holes.map((hole) => hole.hole)).size === 18 && holes.every((hole) => hole.hole >= 1 && hole.hole <= 18 && hole.par >= 3 && hole.par <= 6);
  const validTees = teeSets.length > 0 && teeSets.every((tee) => tee.name.length > 0 && tee.name.length <= 40 && tee.yardages.length === 18 && tee.yardages.every((yards) => Number.isInteger(yards) && yards >= 50 && yards <= 900));
  if (!validHoles || !validTees) return null;
  return { holes, teeSets, notes: Array.isArray(value.notes) ? value.notes.filter((note: unknown) => typeof note === 'string').slice(0, 8) : [] };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return fail('Method not allowed', 405);

  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader) return fail('Unauthorized', 401);
  let body: { eventId?: string; imageBase64?: string; mimeType?: string };
  try { body = await request.json(); } catch { return fail('Invalid request body', 400); }
  const eventId = body.eventId?.trim() ?? '';
  const base64 = body.imageBase64?.replace(/\s/g, '') ?? '';
  const mimeType = body.mimeType === 'image/png' ? 'image/png' : body.mimeType === 'image/jpeg' ? 'image/jpeg' : '';
  // Base64 increases payload size by ~33%. Keep the raw image under 6 MiB.
  if (!eventId || !mimeType || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 8_400_000) return fail('Upload one JPG or PNG scorecard image smaller than 6 MB.', 400);

  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData.user) return fail('Unauthorized', 401);
  const { data: isAdmin, error: adminError } = await caller.rpc('is_event_admin', { target_event: eventId });
  if (adminError || !isAdmin) return fail('Only an event admin can scan this scorecard.', 403);

  const apiKey = Deno.env.get('OPENAI_API_KEY') ?? '';
  if (!apiKey) return fail('Scorecard scanning has not been configured yet. Ask an organizer to add the extraction service key.', 503);
  const prompt = `Read this golf-course scorecard. Return ONLY valid JSON with this exact shape:
{"holes":[{"hole":1,"par":4},...18 unique holes],"teeSets":[{"name":"Blue","yardages":[401,...18 integers]}],"notes":["brief uncertainty only"]}.
Extract all visible tee/color columns. Yardages must appear in hole order 1 through 18. Never invent a value: if the photo is incomplete or a cell is illegible, return an empty teeSets array and state why in notes. Do not include slope, rating, handicap index, or totals as yardages.`;
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Current OpenAI vision documentation uses GPT-5.6 for Responses image
      // input. Keep this overrideable for an organization-approved model.
      model: Deno.env.get('SCORECARD_OCR_MODEL') || 'gpt-5.6',
      temperature: 0,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: `data:${mimeType};base64,${base64}`, detail: 'high' },
      ] }],
    }),
  });
  if (!response.ok) {
    // Keep the provider body in protected Function Logs, while returning only
    // the actionable category to the signed-in event admin.
    const providerDetail = (await response.text()).slice(0, 1_000);
    console.error(JSON.stringify({
      event: 'scorecard_openai_rejection',
      status: response.status,
      detail: providerDetail,
    }));
    const message = response.status === 401 || response.status === 403
      ? 'OpenAI rejected the configured API key. Check that this is an API-platform key with project access.'
      : response.status === 429
        ? 'OpenAI has no available quota for this project. Check API billing or rate limits, then try again.'
        : response.status === 400
          ? 'OpenAI rejected this image request. Try a JPG or PNG scorecard photo smaller than 6 MB.'
          : `The scorecard extraction service was rejected by OpenAI (HTTP ${response.status}). Check Edge Function Logs for the provider detail.`;
    return fail(message, 502);
  }
  const raw = textFromResponse(await response.json());
  const json = raw.match(/\{[\s\S]*\}/)?.[0] ?? '';
  try {
    const candidate = validateCandidate(JSON.parse(json));
    if (!candidate) return fail('The photo did not contain a complete readable scorecard. Try a brighter, straight-on photo.', 422);
    return new Response(JSON.stringify(candidate), { status: 200, headers: cors });
  } catch {
    return fail('The scorecard extraction service returned an unreadable result. Please try another photo.', 422);
  }
});
