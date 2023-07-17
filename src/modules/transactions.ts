import { sha256, dataSlice } from "ethers";
import { BadRequestError } from "../errors";

import Database from "./database";
import Contract from "./contract";

const averagePerPersonRewardYesterday = 50;
const rewardCap = 10000;

// rewards should be given out every 4 hours
// but users are reward daily
// is there a queue?
// transactions are batched every 4 hours

export default (database: Database, contract: Contract) => {
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

  return {
    newTransaction: () => {
      console.log("creating account, really?");
    },
    loadTransactions: (identity: string) =>
      database.getActiveTransactions(identity).then((transactions) =>
        transactions.map((t) => ({
          amount: t.amount,
          createdAt: t.created_at,
          message: t.message,
        }))
      ),

    requestWithdrawal: (identity: string, amount: number) =>
      Promise.all([
        contract.getWithdrawals(identity),
        contract.getDeposits(identity),
        database.getActiveTransactions(identity),
      ])
        .then(([withdrawals, deposits, transactions]) => {
          const allowance =
            transactions.reduce((acc, tx) => acc + tx.amount, 0) +
            deposits.reduce((acc, i) => acc + parseInt(i), 0) -
            withdrawals.reduce((acc, i) => acc + parseInt(i), 0);

          let _withdrawalId = sha256(identity);
          for (let i = 0; i < withdrawals.length; ++i) {
            _withdrawalId = sha256(_withdrawalId);
          }

          if (amount > allowance) {
            throw new BadRequestError("Amount exceeds account balance");
          }

          const withdrawalId = dataSlice(_withdrawalId, 0, 8);

          return Promise.all([
            Promise.resolve(withdrawalId),
            contract.signTransaction(identity, withdrawalId, amount),
          ]);
        })
        .then(([withdrawalId, signature]) => ({
          signature,
          withdrawalId,
        })),
  };
};
