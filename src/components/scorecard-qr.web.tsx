import { QRCodeSVG } from 'qrcode.react';
import React from 'react';

export function ScorecardQr({ value, size = 244 }: { value: string; size?: number }) {
  return (
    <QRCodeSVG
      value={value}
      size={size}
      bgColor="#ffffff"
      fgColor="#111713"
      level="M"
      marginSize={2}
      title="Offline scorecard receipt"
    />
  );
}
