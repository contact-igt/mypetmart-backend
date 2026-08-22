import { Router } from "express";

import { handleStorefrontGetStoreProfile } from "./settings.controller.js";

// Public — no authenticate()/authorize() gate, same as storefront-category.routes.ts.
export const storefrontSettingsRouter = Router();

storefrontSettingsRouter.get("/", (req, res, next) => {
  void handleStorefrontGetStoreProfile(req, res, next);
});
