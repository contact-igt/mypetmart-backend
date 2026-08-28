import { Router } from "express";

import { handleListProductTestimonials, handleListStorefrontTestimonials } from "./storefront-testimonial.controller.js";

export const storefrontTestimonialRouter = Router();
storefrontTestimonialRouter.get("/", (req, res, next) => void handleListStorefrontTestimonials(req, res, next));

export const storefrontProductTestimonialRouter = Router();
storefrontProductTestimonialRouter.get("/:productId/testimonials", (req, res, next) => void handleListProductTestimonials(req, res, next));
