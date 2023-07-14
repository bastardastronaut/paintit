import Database from "./database";

export default (database: Database) => ({
  createAccount: (address: string, email?: string, accountId?: string) => {
    // create user
    return database.insertUser(address)
  },
  updateAccount: () => {
    // verify captcha token
    // update account details
    console.log("creating account");
  },
});
