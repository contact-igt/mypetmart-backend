import bcrypt from "bcrypt";

const BCRYPT_SALT_ROUNDS = 12;

export const PasswordService = {
  async hash(password: string): Promise<string> {
    return await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  },

  async verify(password: string, hash: string): Promise<boolean> {
    return await bcrypt.compare(password, hash);
  }
};
