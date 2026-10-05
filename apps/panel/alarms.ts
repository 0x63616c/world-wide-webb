import { requireOptionalNativeModule } from "expo";

export const panelAlarms = requireOptionalNativeModule<{
  configure(url: string, token: string, clientId: string, clientSecret: string): Promise<void>;
  syncNextAlarm(json: string): Promise<void>;
  refresh(): Promise<void>;
}>("PanelAlarms");
