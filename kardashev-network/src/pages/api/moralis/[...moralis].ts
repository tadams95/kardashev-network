import { MoralisNextApi } from "@moralisweb3/next";

const apiKey = process.env.MORALIS_API_KEY;
const nextAuthUrl = process.env.NEXTAUTH_URL;

if (!apiKey || !nextAuthUrl) {
  throw new Error("Moralis API key or NextAuth URL is undefined");
}

export default MoralisNextApi({
  apiKey: apiKey,
  authentication: {
    domain: "kardashev.network",
    uri: nextAuthUrl,
    timeout: 120,
  },
});
