/**
 * Business model derivation from discovery artifacts (Increment 4).
 *
 * Reads the materialized discovery baseline (permissions, entities, workflows,
 * features) and computes:
 *  - role → permission → resource matrix
 *  - entity-relationship summary
 *  - workflow ownership by role
 *  - admin capability: which roles hold administrative permissions
 */
import type { CoreServices } from '../core/services.ts';
import type { DiscoveryBaseline } from './materialize.ts';
import type { Artifact } from '../core/artifact.ts';

export interface RolePermission {
  readonly role: string;
  readonly resource: string;
  readonly permissionKey: string;
}

export interface EntitySummary {
  readonly name: string;
  readonly key: string;
  readonly fieldCount: number;
  readonly requiredFields: string[];
  readonly fields: readonly { name: string; type: string; required: boolean }[];
}

export interface WorkflowSummary {
  readonly key: string;
  readonly title: string;
  readonly stepCount: number;
}

export interface FeatureSummary {
  readonly key: string;
  readonly title: string;
  readonly moduleKey: string;
}

export interface AdminCapability {
  readonly role: string;
  readonly resources: readonly string[];
  readonly permissionKeys: readonly string[];
  readonly reason: string;
}

export interface BusinessModel {
  readonly projectId: string;
  readonly roles: readonly string[];
  readonly rolePermissions: readonly RolePermission[];
  readonly entities: readonly EntitySummary[];
  readonly workflows: readonly WorkflowSummary[];
  readonly features: readonly FeatureSummary[];
  readonly adminCapabilities: readonly AdminCapability[];
}

function collectUniqueRoles(rolePermissions: readonly RolePermission[]): readonly string[] {
  const roles = new Set<string>();
  for (const rp of rolePermissions) roles.add(rp.role);
  return [...roles].sort();
}

function deriveAdminCapabilities(
  rolePermissions: readonly RolePermission[],
  entities: readonly EntitySummary[],
): readonly AdminCapability[] {
  const byRole = new Map<string, { resources: Set<string>; keys: Set<string> }>();
  for (const rp of rolePermissions) {
    const entry = byRole.get(rp.role) ?? { resources: new Set(), keys: new Set() };
    entry.resources.add(rp.resource);
    entry.keys.add(rp.permissionKey);
    byRole.set(rp.role, entry);
  }

  const criticalResources = ['task', 'project', 'user', 'organization', 'billing', 'admin'];
  const criticalPermKeys = ['manage', 'delete', 'admin', 'configure'];

  const result: AdminCapability[] = [];
  for (const [role, { resources, keys }] of byRole.entries()) {
    const resArray = [...resources];
    const keyArray = [...keys];
    const adminResources = resArray.filter((r) =>
      criticalResources.some((c) => r.toLowerCase().includes(c)),
    );
    const adminKeys = keyArray.filter((k) =>
      criticalPermKeys.some((c) => k.toLowerCase().includes(c)),
    );
    if (adminResources.length > 0 || adminKeys.length > 0) {
      result.push({
        role,
        resources: resArray.sort(),
        permissionKeys: keyArray.sort(),
        reason:
          `Holds permissions on critical resources: ${adminResources.join(', ') || 'none'}; ` +
          `admin permission keys: ${adminKeys.join(', ') || 'none'}`,
      });
    }
  }
  return result;
}

export async function deriveBusinessModel(
  services: CoreServices,
  baseline: DiscoveryBaseline,
): Promise<BusinessModel> {
  const { store, graph } = services;

  const rolePermissions: RolePermission[] = [];
  const entities: EntitySummary[] = [];
  const workflows: WorkflowSummary[] = [];
  const features: FeatureSummary[] = [];

  for (const entry of baseline.permissions) {
    const artifact = await store.require(entry.artifactId);
    const roles = artifact.attributes['roles'] as readonly string[];
    const resource = artifact.attributes['resource'] as string;
    for (const role of roles) {
      rolePermissions.push({ role, resource, permissionKey: entry.key });
    }
  }

  for (const entry of baseline.entities) {
    const artifact = await store.require(entry.artifactId);
    const fields = artifact.attributes['fields'] as readonly { name: string; type: string; required: boolean }[];
    entities.push({
      name: artifact.title,
      key: entry.key,
      fieldCount: fields.length,
      requiredFields: fields.filter((f) => f.required).map((f) => f.name),
      fields,
    });
  }

  for (const entry of baseline.workflows) {
    const artifact = await store.require(entry.artifactId);
    const steps = artifact.attributes['steps'] as readonly string[];
    workflows.push({
      key: entry.key,
      title: artifact.title,
      stepCount: steps.length,
    });
  }

  for (const entry of baseline.features) {
    const artifact = await store.require(entry.artifactId);
    const moduleKey = artifact.attributes['moduleKey'] as string;
    features.push({
      key: entry.key,
      title: artifact.title,
      moduleKey,
    });
  }

  const adminCapabilities = deriveAdminCapabilities(rolePermissions, entities);
  const roles = collectUniqueRoles(rolePermissions);

  return {
    projectId: baseline.projectId,
    roles,
    rolePermissions,
    entities,
    workflows,
    features,
    adminCapabilities,
  };
}