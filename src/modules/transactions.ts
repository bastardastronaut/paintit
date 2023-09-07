import { sha256, dataSlice } from "ethers";
import { BadRequestError, TooManyRequestsError } from "../errors";
import Clock from "./clock";

import Database from "./database";
import Contract from "./contract";

const averagePerPersonRewardYesterday = 50;
const rewardCap = 10000;

// rewards should be given out every 4 hours
// but users are reward daily
// is there a queue?
// transactions are batched every 4 hours

export default (clock: Clock, database: Database, contract: Contract) => {
  // this is the transactions backend.
  // keeps track of daily rewards, and limits them.
  //
  // we can use yesterday's data to set today's rewards proportionately.
  // we can also roll over "unused" rewards from previous cycle to go above the current limit
  // but previous iteration results should still affect proprtionately to the original limit
  //
  // once it runs out it's over anyway but it can be self regulating this way
  // we can also do this every 8 hours instead of daily to support timezones.
  //
  //
  // rewards are given out for
  // signups, every day logins.
  // make sure to reward them similarly.
  //
  // let's say a login is 5 ART
  // login with activity is 5 ART
  //
  // premium lobbies can be 100 ART
  // anyone can create premium lobbies and they'll get a proportionately larger chunk
  //
  // participation SHOULD burn tokens
  // supply from drawings is constantly increasing anyway
  //
  // rewards = rarity * size, size proportionately gives more rewards as it's distributed among more users, should also reward the effort
  // but if the end result is a common 256x256
  //
  // we need more granular rarity
  //
  // should size be reflected in rarity?
  //
  // common
  // uncommon * 5 votes > 50%
  // rare * 100 votes > 80%
  // legendary * 1000 votes > 95%
  //
  // rarity based rewards
  //  - common 50 ART
  //  - rare 500 ART
  //  - legendary 5000 ART
  //
  //

  // withdraw receipts.
  // keep getting larger and larger but only can be used once

  const pendingWithdrawals = new Map<string, number>();

  const loadAllowance = (identity: string) =>
    Promise.all([
      contract.getWithdrawals(identity),
      contract.getDeposits(identity),
      database.getActiveTransactions(identity),
    ]).then(
      ([withdrawals, deposits, transactions]) =>
        transactions.reduce((acc, tx) => acc + tx.amount, 0) +
        deposits.reduce((acc, i) => acc + parseInt(i), 0) -
        withdrawals.reduce((acc, i) => acc + parseInt(i), 0)
    );

  return {
    spendArt: (identity: string, amount: number, message: string) =>
      loadAllowance(identity).then((allowance) => {
        if (allowance < amount) throw new BadRequestError("insufficient funds");

        return database.insertTransactions([
          { identity, amount: -amount, message },
        ]);
      }),

    loadTransactions: (identity: string) =>
      database.getActiveTransactions(identity).then((transactions) =>
        transactions.map((t) => ({
          amount: t.amount,
          createdAt: t.created_at,
          message: t.message,
        }))
      ),

    requestWithdrawal: (identity: string, amount: number) => {
      if (pendingWithdrawals.get(identity))
        throw new TooManyRequestsError("withdrawal pending");

      return Promise.all([
        contract.getWithdrawals(identity),
        loadAllowance(identity),
      ])
        .then(([withdrawals, allowance]) => {
          let _withdrawalId = sha256(identity);
          for (let i = 0; i < withdrawals.length; ++i) {
            _withdrawalId = sha256(_withdrawalId);
          }

          if (amount > allowance) {
            throw new BadRequestError("Amount exceeds account balance");
          }

          const withdrawalId = dataSlice(_withdrawalId, 0, 8);

          pendingWithdrawals.set(identity, amount);

          clock.in(60).then(() => pendingWithdrawals.delete(identity));

          const signedAt = clock.now;

          return Promise.all([
            Promise.resolve(withdrawalId),
            Promise.resolve(signedAt),
            contract.signTransaction(identity, withdrawalId, amount, signedAt),
          ]);
        })
        .then(([withdrawalId, signedAt, signature]) => ({
          signature,
          withdrawalId,
          signedAt,
        }));
    },
  };
};
