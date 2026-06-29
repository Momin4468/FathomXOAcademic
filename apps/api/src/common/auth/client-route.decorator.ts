import { SetMetadata } from "@nestjs/common";

export const IS_CLIENT_KEY = "isClientRoute";

/**
 * Mark a controller/route as belonging to the CLIENT portal plane (Module 18).
 * The global business AuthGuard YIELDS on these (a business token can't reach
 * them); the controller's own ClientAuthGuard authenticates with a client token.
 * Mirrors @PfRoute — this is how the three planes stay disjoint in one process.
 */
export const ClientRoute = () => SetMetadata(IS_CLIENT_KEY, true);
