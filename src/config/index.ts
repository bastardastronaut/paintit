import localConfig from "./local";
import productionConfig from "./production";

let config: {
  rzrSocket: {
    signalServerUrl: string;
    rtc: {
      iceServers: Array<{
        urls: string;
      }>;
    };
  };
  ethereum: {
  };
};

if (process.env.NODE_ENV === "production") {
  config = productionConfig;
} else {
  config = localConfig;
}

export default config;
