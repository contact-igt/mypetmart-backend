import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleCreateAddress,
  handleDeleteAddress,
  handleGetAddress,
  handleListAddresses,
  handleSetDefaultAddress,
  handleUpdateAddress
} from "./address.controller.js";

export const storefrontAddressRouter = Router();

storefrontAddressRouter.use(authenticate("customer"));

storefrontAddressRouter.get("/", (req, res, next) => {
  void handleListAddresses(req, res, next);
});

storefrontAddressRouter.post("/", (req, res, next) => {
  void handleCreateAddress(req, res, next);
});

storefrontAddressRouter.get("/:addressId", (req, res, next) => {
  void handleGetAddress(req, res, next);
});

storefrontAddressRouter.patch("/:addressId", (req, res, next) => {
  void handleUpdateAddress(req, res, next);
});

storefrontAddressRouter.patch("/:addressId/default", (req, res, next) => {
  void handleSetDefaultAddress(req, res, next);
});

storefrontAddressRouter.delete("/:addressId", (req, res, next) => {
  void handleDeleteAddress(req, res, next);
});
