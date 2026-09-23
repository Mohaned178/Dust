export function buildElevationCommand(execPath: string, args: string[]): string {
  const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const file = quote(execPath);
  if (args.length === 0) return `Start-Process -FilePath ${file} -Verb RunAs`;
  return `Start-Process -FilePath ${file} -ArgumentList ${args.map(quote).join(',')} -Verb RunAs`;
}
