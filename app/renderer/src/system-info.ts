import type {
  SystemInfoBios,
  SystemInfoCpu,
  SystemInfoGpu,
  SystemInfoLive,
  SystemInfoOs,
  SystemInfoStatic,
} from '@dust/core';
function present(value: string | null): value is string {
  return value !== null && value.length > 0;
}

export function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const gigabytes = Math.round((bytes / 1024 ** 3) * 10) / 10;
  return `${gigabytes} GB`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatUptime(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return 'under a minute';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

export function formatCapturedAt(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function formatOsName(os: SystemInfoOs): string | null {
  const name = [os.name, os.version].filter(present).join(' ');
  return name.length > 0 ? name : null;
}

export function formatOsLine(os: SystemInfoOs): string | null {
  const name = formatOsName(os);
  const build = os.build === null ? null : `(Build ${os.build})`;
  const line = [name, build].filter(present).join(' ');
  return line.length > 0 ? line : null;
}

export function formatCpuSpec(cpu: SystemInfoCpu): string | null {
  if (cpu.physicalCores !== null && cpu.logicalThreads !== null) {
    return `${cpu.physicalCores} cores / ${cpu.logicalThreads} threads`;
  }
  if (cpu.logicalThreads !== null) return `${cpu.logicalThreads} threads`;
  if (cpu.physicalCores !== null) return `${cpu.physicalCores} cores`;
  return null;
}

export function formatCpuLine(cpu: SystemInfoCpu): string {
  const spec = formatCpuSpec(cpu);
  return spec === null ? cpu.model : `${cpu.model} (${spec})`;
}

export function formatGpuLine(gpu: SystemInfoGpu): string {
  return gpu.driverVersion === null ? gpu.name : `${gpu.name} (Driver ${gpu.driverVersion})`;
}

export function joinBoard(manufacturer: string | null, product: string | null): string | null {
  const maker = manufacturer?.trim() ?? '';
  const model = product?.trim() ?? '';
  if (maker.length === 0 && model.length === 0) return null;
  if (maker.length === 0) return model;
  if (model.length === 0) return maker;
  const makerKey = maker.toLowerCase();
  const modelKey = model.toLowerCase();
  if (modelKey.includes(makerKey)) return model;
  if (makerKey.includes(modelKey)) return maker;
  return `${maker} ${model}`;
}

export function formatBios(bios: SystemInfoBios): string | null {
  if (bios.version !== null && bios.date !== null) return `${bios.version} (${bios.date})`;
  return bios.version ?? bios.date;
}

export function formatSystemInfoText(
  snapshot: SystemInfoStatic,
  live: SystemInfoLive | null,
): string {
  const blocks: string[][] = [['Dust System Info', `Captured: ${formatCapturedAt(snapshot.capturedAt)}`]];

  const system: string[] = [];
  const osLine = formatOsLine(snapshot.os);
  if (osLine !== null) system.push(`OS: ${osLine}`);
  if (snapshot.os.arch !== null) system.push(`Arch: ${snapshot.os.arch}`);
  if (snapshot.hostname !== null) system.push(`Hostname: ${snapshot.hostname}`);
  if (snapshot.uptimeMs !== null) {
    const uptime = formatUptime(snapshot.uptimeMs);
    if (uptime !== null) system.push(`Uptime: ${uptime}`);
  }
  if (system.length > 0) blocks.push(system);

  const compute: string[] = [];
  if (snapshot.cpu !== null) compute.push(`CPU: ${formatCpuLine(snapshot.cpu)}`);
  if (live !== null) {
    compute.push(`RAM: ${formatMemory(live.memTotalBytes)} total · ${formatMemory(live.memUsedBytes)} used`);
  }
  if (compute.length > 0) blocks.push(compute);

  if (snapshot.gpus.length > 0) {
    blocks.push(snapshot.gpus.map((gpu) => `GPU: ${formatGpuLine(gpu)}`));
  }

  const firmware: string[] = [];
  const board =
    snapshot.board === null ? null : joinBoard(snapshot.board.manufacturer, snapshot.board.product);
  if (board !== null) firmware.push(`Motherboard: ${board}`);
  const bios = snapshot.bios === null ? null : formatBios(snapshot.bios);
  if (bios !== null) firmware.push(`BIOS: ${bios}`);
  if (firmware.length > 0) blocks.push(firmware);

  return blocks.map((block) => block.join('\n')).join('\n\n');
}
