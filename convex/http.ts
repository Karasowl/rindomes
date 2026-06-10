import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// auth.addHttpRoutes already registers every Convex Auth HTTP endpoint,
// INCLUDING the email-verification (OTP) flow used by Password({ verify: ResendOTP }).
// Do NOT add a redundant /verify route here — the OTP is exchanged through the
// standard signIn('password', { flow: 'email-verification', code }) action path.
auth.addHttpRoutes(http);

export default http;
