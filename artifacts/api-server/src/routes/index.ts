import { Router, type IRouter } from "express";
import healthRouter from "./health";
import geminiRouter from "./gemini";
import chatHistoryRouter from "./chat-history";

const router: IRouter = Router();

router.use(healthRouter);
router.use(geminiRouter);
router.use(chatHistoryRouter);

export default router;
