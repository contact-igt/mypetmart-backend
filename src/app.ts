import compression from "compression";
import express from "express";
import helmet from "helmet";

import { APPLICATION_CONSTANTS } from "./constants/application.constants.js";
import { errorHandlerMiddleware } from "./middlewares/error/error-handler.middleware.js";
import { notFoundMiddleware } from "./middlewares/error/not-found.middleware.js";
import { requestIdMiddleware } from "./middlewares/request/request-id.middleware.js";
import { v1Router } from "./routes/v1/index.js";
import { httpLogger } from "./utils/logger.js";

export const app = express();

app.disable("x-powered-by");

app.use(helmet());
app.use(compression());
app.use(requestIdMiddleware);
app.use(httpLogger);
app.use(express.json({ limit: APPLICATION_CONSTANTS.requestBodyLimit }));
app.use(express.urlencoded({ extended: false, limit: APPLICATION_CONSTANTS.requestBodyLimit }));

app.use(APPLICATION_CONSTANTS.apiBasePath, v1Router);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);
