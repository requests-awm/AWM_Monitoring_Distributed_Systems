import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { OrgRole } from "@awm/shared";
import type { Request } from "express";

/**
 * Role-based access control (Owner > Administrator > Operator > Viewer),
 * enforced in the API per IMPLEMENTATION_PLAN §1.3 — RLS stays service-role-only.
 *
 * Identity source: Supabase Auth JWT once credentials arrive (seam below).
 * Until then, dev-header auth: `x-user-email` / `x-user-role`; requests with
 * no headers act as the owner so the sample dashboard works unauthenticated.
 */

const ROLE_RANK: Record<OrgRole, number> = {
  owner: 3,
  administrator: 2,
  operator: 1,
  viewer: 0,
};

export const MIN_ROLE_KEY = "min_role";
export const MinRole = (role: OrgRole): MethodDecorator & ClassDecorator =>
  SetMetadata(MIN_ROLE_KEY, role);

export interface RequestUser {
  email: string;
  role: OrgRole;
}

export function currentUser(req: Request): RequestUser {
  // TODO(m1): verify a Supabase JWT from the Authorization header instead.
  const roleHeader = req.headers["x-user-role"];
  const emailHeader = req.headers["x-user-email"];
  const parsedRole = OrgRole.safeParse(typeof roleHeader === "string" ? roleHeader : undefined);
  return {
    email: typeof emailHeader === "string" ? emailHeader : "dev@local",
    role: parsedRole.success ? parsedRole.data : "owner",
  };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<OrgRole | undefined>(MIN_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required === undefined) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const user = currentUser(req);
    if (ROLE_RANK[user.role] < ROLE_RANK[required]) {
      throw new ForbiddenException(`Requires ${required} role or higher (you are ${user.role})`);
    }
    return true;
  }
}
