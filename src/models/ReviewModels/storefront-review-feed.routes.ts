import { Router } from "express";

import { handleListStorefrontReviewFeed } from "./storefront-review-feed.controller.js";

export const storefrontReviewFeedRouter = Router();
storefrontReviewFeedRouter.get("/", (req, res, next) => void handleListStorefrontReviewFeed(req, res, next));
