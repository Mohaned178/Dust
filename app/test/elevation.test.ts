import { describe, expect, it } from 'vitest';
import { buildElevationCommand } from '../src/main/elevation';

describe('buildElevationCommand', () => {
  it('builds a Start-Process command without arguments', () => {
    expect(buildElevationCommand('C:\\Apps\\Dust\\Dust.exe', [])).toBe(
      "Start-Process -FilePath 'C:\\Apps\\Dust\\Dust.exe' -Verb RunAs",
    );
  });

  it('quotes arguments and doubles embedded quotes', () => {
    expect(buildElevationCommand('C:\\Dust.exe', ["C:\\it's here"])).toBe(
      "Start-Process -FilePath 'C:\\Dust.exe' -ArgumentList 'C:\\it''s here' -Verb RunAs",
    );
  });
});
