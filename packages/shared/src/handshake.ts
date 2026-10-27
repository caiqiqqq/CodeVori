export interface HelloMessage {
  type: "zcode-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
  sourceServerId?: string;
}

export interface HelloAckMessage {
  type: "zcode-hello-ack";
  version: string;
  clientId: string;
}
