import {
  EventLog,
  Wallet,
  Contract,
  JsonRpcProvider,
  toBeArray,
  Provider,
  concat,
  getBytes,
  zeroPadValue,
} from "ethers";

import config from "../config";

export default class PaintContract {
  private contract: Contract;
  private provider: Provider;
  private account: Wallet;

  constructor(account: Wallet) {
    this.account = account;
    this.provider = new JsonRpcProvider(config.ethereum.key);
    this.contract = new Contract(
      config.ethereum.contractAddress,
      config.ethereum.abi,
      this.provider
    );
  }

  getWithdrawals(address: string) {
    return this.contract
      .queryFilter(this.contract.filters.Withdrawal(address))
      .then((eventLogs) =>
        eventLogs.map((event) => (event as EventLog).args[1])
      );
  }

  getDeposits(address: string) {
    return this.contract
      .queryFilter(this.contract.filters.Deposit(address))
      .then((eventLogs) =>
        eventLogs.map((event) => (event as EventLog).args[1])
      );
  }

  async initialize() {}

  async getBalance() {
    return this.contract.balanceOf(this.account.address);
  }

  async signTransaction(
    identity: string,
    withdrawalId: string,
    amount: number
  ) {
    return this.account.signMessage(
      getBytes(
        concat([
          zeroPadValue(identity, 20),
          zeroPadValue(toBeArray(withdrawalId), 8),
          zeroPadValue(toBeArray(amount), 32),
        ])
      )
    );
  }
}
