import { SetMetadata } from "@nestjs/common";

export const IS_PF_KEY = "isPfRoute";

/**
 * Mark a controller/route as belonging to the PERSONAL-FINANCE plane (§11). The
 * global business AuthGuard YIELDS on these (it neither authenticates them nor
 * lets a business token through); the controller's own PfAuthGuard authenticates
 * them with a PF token instead. This is how the two planes stay disjoint even
 * though they share one process.
 */
export const PfRoute = () => SetMetadata(IS_PF_KEY, true);
