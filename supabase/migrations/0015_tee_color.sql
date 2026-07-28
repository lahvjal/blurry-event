-- Which set of tees the field is playing.
--
-- The score entry screen has always shown "WHITE" under the yardage — it was
-- hardcoded, so a group playing the blues saw the wrong label above yardages
-- that were right. Now it's the admin's to set alongside par and yardage.
--
-- Deliberately text rather than an enum: courses name their tees all sorts of
-- things (Championship, Senior, Forward, Member), and a constraint here would
-- mean a migration every time one of them didn't fit.

alter table events
  add column if not exists tee_color text not null default 'White';
