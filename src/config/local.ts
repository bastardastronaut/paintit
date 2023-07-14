
const config = {
  rzrSocket: {
    signalServerUrl: "ws://localhost:8081",
    rtc: {
      iceServers: [
        {
          urls: "stun:openrelay.metered.ca:80",
        },
        {
          urls: "turn:openrelay.metered.ca:443?transport=tcp",
          username: "openrelayproject",
          credential: "openrelayproject",
        },
        /*
    {
      urls: "stun:openrelay.metered.ca:80",
    },*/
      ],
    },
  },
  ethereum: {
    contracts: {
    },
  },
};

export default config;
