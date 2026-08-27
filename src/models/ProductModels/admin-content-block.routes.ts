import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCreateContentBlock,
  handleAdminDeleteContentBlock,
  handleAdminReorderContentBlocks,
  handleAdminUpdateContentBlock
} from "./product-content-block.controller.js";

export const adminContentBlockRouter = Router();

adminContentBlockRouter.use(authenticate("admin"));

adminContentBlockRouter.post("/:productId/content-blocks", (req, res, next) => {
  void handleAdminCreateContentBlock(req, res, next);
});

adminContentBlockRouter.patch("/:productId/content-blocks/reorder", (req, res, next) => {
  void handleAdminReorderContentBlocks(req, res, next);
});

adminContentBlockRouter.patch("/:productId/content-blocks/:blockId", (req, res, next) => {
  void handleAdminUpdateContentBlock(req, res, next);
});

adminContentBlockRouter.delete("/:productId/content-blocks/:blockId", (req, res, next) => {
  void handleAdminDeleteContentBlock(req, res, next);
});
