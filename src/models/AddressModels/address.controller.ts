import type { NextFunction, Request, Response } from "express";

import { SessionInvalidError } from "../AuthModels/auth.errors.js";
import { sendSuccess } from "../../utils/api-response.js";
import { AddressService } from "./address.service.js";
import { createAddressSchema, parseAddressId, updateAddressSchema } from "./address.validation.js";
import type { CreateAddressInput, UpdateAddressInput } from "./address.types.js";

function requireUserId(req: Request): number {
  if (!req.user) {
    throw new SessionInvalidError();
  }
  return req.user.id;
}

export async function handleListAddresses(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const addresses = await AddressService.listAddresses(requireUserId(req));
    sendSuccess(res, 200, addresses);
  } catch (error) {
    next(error);
  }
}

export async function handleGetAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const addressId = parseAddressId(req.params.addressId);
    const address = await AddressService.getAddress(requireUserId(req), addressId);
    sendSuccess(res, 200, address);
  } catch (error) {
    next(error);
  }
}

export async function handleCreateAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = createAddressSchema.parse(req.body) as CreateAddressInput;
    const address = await AddressService.createAddress(requireUserId(req), input);
    sendSuccess(res, 201, address);
  } catch (error) {
    next(error);
  }
}

export async function handleUpdateAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const addressId = parseAddressId(req.params.addressId);
    const input = updateAddressSchema.parse(req.body) as UpdateAddressInput;
    const address = await AddressService.updateAddress(requireUserId(req), addressId, input);
    sendSuccess(res, 200, address);
  } catch (error) {
    next(error);
  }
}

export async function handleSetDefaultAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const addressId = parseAddressId(req.params.addressId);
    const address = await AddressService.setDefaultAddress(requireUserId(req), addressId);
    sendSuccess(res, 200, address);
  } catch (error) {
    next(error);
  }
}

export async function handleDeleteAddress(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const addressId = parseAddressId(req.params.addressId);
    await AddressService.deleteAddress(requireUserId(req), addressId);
    sendSuccess(res, 200, { deleted: true });
  } catch (error) {
    next(error);
  }
}
