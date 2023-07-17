import localConfig from "./local";
import productionConfig from "./production";
import abi from "./contractABI.json";

let config: {
  ethereum: {
    chainId: number;
    contractAddress: string;
    key: string;
  };
};

if (process.env.NODE_ENV === "production") {
  config = productionConfig;
} else {
  config = localConfig;
}

export default { ...config, ethereum: { ...config.ethereum, abi } };
