import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";

import { corsOptions } from "./config/cors.config.js";
import { serverConfig } from "./config/server.config.js";
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
app.use(cookieParser());
app.use(cors(corsOptions));
app.use(express.json({ limit: serverConfig.requestBodyLimit }));
app.use(express.urlencoded({ extended: false, limit: serverConfig.requestBodyLimit }));

app.use(serverConfig.apiBasePath, v1Router);

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);
