import {
  EventLog,
  sha256,
  Wallet,
  Contract,
  toBeArray,
  Provider,
  concat,
  getBytes,
  zeroPadValue,
} from "ethers";

import config from "../config";

export default class PaintContract {
  private contract: Contract;
  private account: Wallet;

  constructor(account: Wallet) {
    this.account = account;
    this.contract = new Contract(
      config.ethereum.contractAddress,
      config.ethereum.abi,
      this.account
    );
    // this.submitDrawing(sha256("0x4324b23423ba"), 100);
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

  submitDrawing(hash: string, artValue: number) {
    return this.contract.submitDrawing(hash, artValue).then((tx) => tx.hash);
  }

  async initialize() {}

  async getBalance() {
    return this.contract.balanceOf(this.account.address);
  }

  async signTransaction(
    identity: string,
    withdrawalId: string,
    amount: number,
    createdAt: number
  ) {
    return this.account.signMessage(
      getBytes(
        concat([
          zeroPadValue(identity, 20),
          zeroPadValue(toBeArray(withdrawalId), 8),
          zeroPadValue(toBeArray(createdAt), 8),
          zeroPadValue(toBeArray(amount), 32),
        ])
      )
    );
  }
}
