// beeOS global modül arayüzleri. Çalışma zamanı etkisi yok, sadece checkJs için.
// Yeni bir global modül eklerken buraya imzasını yaz; ES5 çıktısı değişmez.

interface BeeOSPlatform {
  name(): "tv" | "pc" | "web";
  isMock(): boolean;
  info(): Record<string, unknown>;
  api(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body: unknown, cb: (res: unknown) => void): void;
  detect(cb: () => void): void;
}

interface BeeOSStore {
  get<T = unknown>(key: string, fallback?: T): T;
  set(key: string, value: unknown): void;
  remove(key: string): void;
  clear(): void;
}

interface BeeOSSound {
  play(name: string): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
}

interface BeeOSChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  geo?: "tr" | "worldwide";
  needsProxy?: boolean;
}

interface BeeOSChannels {
  list(): BeeOSChannel[];
  byId(id: string): BeeOSChannel | null;
}

interface BeeOSLog {
  debug(area: string, msg: string, extra?: Record<string, unknown>): void;
  info(area: string, msg: string, extra?: Record<string, unknown>): void;
  warn(area: string, msg: string, extra?: Record<string, unknown>): void;
  error(area: string, msg: string, extra?: Record<string, unknown>): void;
  tail(n?: number): string[];
}

declare var Platform: BeeOSPlatform;
declare var Store: BeeOSStore;
declare var Sound: BeeOSSound;
declare var Channels: BeeOSChannels;
declare var Log: BeeOSLog;

// webOS köprüsü (TV)
declare var PalmServiceBridge: unknown;
