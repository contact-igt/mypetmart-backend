import { Op, type Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Address, User } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { AddressDefaultRequiredError, AddressNotFoundError } from "./address.errors.js";
import type { AddressJSON, CreateAddressInput, UpdateAddressInput } from "./address.types.js";

function formatAddressDTO(address: Address): AddressJSON {
  return {
    id: address.id,
    label: address.label,
    recipientName: address.recipient_name,
    phone: address.phone,
    line1: address.line_1,
    line2: address.line_2,
    city: address.city,
    state: address.state,
    postalCode: address.postal_code,
    country: address.country,
    isDefault: address.is_default,
    createdAt: address.created_at.toISOString(),
    updatedAt: address.updated_at.toISOString()
  };
}

async function lockCustomer(userId: number, transaction: Transaction): Promise<void> {
  // Locking the parent user row serializes concurrent default-address switches
  // for the same customer, mirroring CartService's findOrCreateCustomerCart.
  await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
}

async function clearExistingDefault(userId: number, transaction: Transaction): Promise<void> {
  await Address.update({ is_default: false }, { where: { user_id: userId, is_default: true }, transaction });
}

export const AddressService = {
  async listAddresses(userId: number): Promise<AddressJSON[]> {
    const addresses = await Address.findAll({
      where: { user_id: userId },
      order: [
        ["is_default", "DESC"],
        ["id", "ASC"]
      ]
    });
    return addresses.map(formatAddressDTO);
  },

  async getAddress(userId: number, addressId: number): Promise<AddressJSON> {
    const address = await Address.findOne({ where: { id: addressId, user_id: userId } });
    if (!address) {
      throw new AddressNotFoundError(addressId);
    }
    return formatAddressDTO(address);
  },

  async createAddress(userId: number, input: CreateAddressInput): Promise<AddressJSON> {
    return sequelize.transaction(async (t) => {
      await lockCustomer(userId, t);

      const hasExisting = (await Address.count({ where: { user_id: userId }, transaction: t })) > 0;
      const shouldBeDefault = input.isDefault === true || !hasExisting;

      if (shouldBeDefault && hasExisting) {
        await clearExistingDefault(userId, t);
      }

      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.addresses, t);
      const created = await Address.create(
        {
          id,
          user_id: userId,
          label: input.label ?? null,
          recipient_name: input.recipientName,
          phone: input.phone,
          line_1: input.line1,
          line_2: input.line2 ?? null,
          city: input.city,
          state: input.state,
          postal_code: input.postalCode,
          country: input.country ?? undefined,
          is_default: shouldBeDefault
        },
        { transaction: t }
      );

      return formatAddressDTO(created);
    });
  },

  async updateAddress(userId: number, addressId: number, input: UpdateAddressInput): Promise<AddressJSON> {
    return sequelize.transaction(async (t) => {
      await lockCustomer(userId, t);

      const address = await Address.findOne({ where: { id: addressId, user_id: userId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!address) {
        throw new AddressNotFoundError(addressId);
      }

      if (input.isDefault === false && address.is_default) {
        throw new AddressDefaultRequiredError();
      }

      if (input.label !== undefined) address.label = input.label;
      if (input.recipientName !== undefined) address.recipient_name = input.recipientName;
      if (input.phone !== undefined) address.phone = input.phone;
      if (input.line1 !== undefined) address.line_1 = input.line1;
      if (input.line2 !== undefined) address.line_2 = input.line2;
      if (input.city !== undefined) address.city = input.city;
      if (input.state !== undefined) address.state = input.state;
      if (input.postalCode !== undefined) address.postal_code = input.postalCode;
      if (input.country !== undefined) address.country = input.country;
      await address.save({ transaction: t });

      if (input.isDefault === true && !address.is_default) {
        await clearExistingDefault(userId, t);
        address.is_default = true;
        await address.save({ transaction: t });
      }

      return formatAddressDTO(address);
    });
  },

  async setDefaultAddress(userId: number, addressId: number): Promise<AddressJSON> {
    return sequelize.transaction(async (t) => {
      await lockCustomer(userId, t);

      const address = await Address.findOne({ where: { id: addressId, user_id: userId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!address) {
        throw new AddressNotFoundError(addressId);
      }

      if (!address.is_default) {
        await clearExistingDefault(userId, t);
        address.is_default = true;
        await address.save({ transaction: t });
      }

      return formatAddressDTO(address);
    });
  },

  async deleteAddress(userId: number, addressId: number): Promise<void> {
    await sequelize.transaction(async (t) => {
      await lockCustomer(userId, t);

      const address = await Address.findOne({ where: { id: addressId, user_id: userId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!address) {
        throw new AddressNotFoundError(addressId);
      }

      const wasDefault = address.is_default;
      if (wasDefault) {
        // The addresses_one_default_user_unique index is backed by a generated column
        // that does not consider deleted_at, so a soft-deleted row still holding
        // is_default=true would keep occupying the one-default-per-user slot. Clear it
        // before destroying so the promotion below can claim that slot.
        address.is_default = false;
        await address.save({ transaction: t });
      }
      await address.destroy({ transaction: t });

      if (wasDefault) {
        // No display-order convention exists on addresses; lowest remaining numeric ID
        // is the documented deterministic promotion rule. Excludes the just-deleted row
        // explicitly rather than relying on paranoid exclusion picking up the destroy()
        // that happened earlier in this same transaction.
        const next = await Address.findOne({
          where: { user_id: userId, id: { [Op.ne]: addressId } },
          order: [["id", "ASC"]],
          transaction: t,
          lock: t.LOCK.UPDATE
        });
        if (next) {
          next.is_default = true;
          await next.save({ transaction: t });
        }
      }
    });
  }
};
