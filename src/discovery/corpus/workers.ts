/**
 * The Discovery Worker Corps — 36 individually specified roles (vision §0.3,
 * roadmap component "The Discovery Worker Corps — 36 Individually Specified
 * Roles").
 *
 * Each role is defined across the twelve axes the vision requires and no two
 * roles perform the same function:
 *
 *   responsibility, inputs, outputs/artifacts, evidence required, dependencies,
 *   verification, failure conditions, rejection/rework behavior, interaction
 *   with the Discovery Boss, interaction with the Red Team/Auditor,
 *   contribution to recursive discovery, contribution to the Master Product
 *   Inventory.
 *
 * Cluster A decides what the product is; Cluster B what it is made of; Cluster
 * C how that structure behaves; Cluster D what it must satisfy beyond stated
 * functionality; Cluster E exists solely to attack the other four clusters'
 * confidence.
 *
 * This module is pure data + pure lookups: no I/O, no clock, no randomness.
 */

export type DiscoveryCluster = 'A' | 'B' | 'C' | 'D' | 'E';

export interface DiscoveryWorkerRole {
  readonly id: string;
  readonly name: string;
  readonly cluster: DiscoveryCluster;
  readonly responsibility: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  readonly evidenceRequired: string;
  readonly dependencies: readonly string[];
  readonly verification: string;
  readonly failureConditions: readonly string[];
  readonly reworkBehavior: string;
  readonly bossInteraction: string;
  readonly auditorInteraction: string;
  readonly recursiveContribution: string;
  readonly mpiContribution: string;
}

/** Every role shares the same §0.14 → §0.18 verification ladder. */
const V =
  'Self-verification against §0.14, then Specialist Verifier review of evidence per §0.18 (never narrative alone).';

export const DISCOVERY_WORKER_ROLES: readonly DiscoveryWorkerRole[] = [
  // --- Cluster A — Understanding Workers -----------------------------------
  {
    id: 'DW-A1',
    name: 'Product Understanding Worker',
    cluster: 'A',
    responsibility:
      'Produce the first, most upstream artifact in the Knowledge Graph: a structured statement of what the user is asking to build, in the user\u2019s own terms, before any inference is layered on top of it.',
    inputs: [
      'The user\u2019s vision statement',
      'Any supplied documents',
      'Prior conversation history',
      'The current Living Blueprint when extending an existing application (§5.3)',
    ],
    outputs: ['Product Understanding Brief, tagged PROJECT-001 (stated goals, users, constraints, non-goals)'],
    evidenceRequired:
      'Every stated goal, user, and constraint must be a direct paraphrase traceable to a specific sentence or document passage in the inputs \u2014 not an inference.',
    dependencies: ['None upstream; this is the department\u2019s entry point.'],
    verification: V,
    failureConditions: [
      'Vision too sparse to reach minimum confidence',
      'Brief contradicts itself',
      'A stated goal cannot be traced to any input',
    ],
    reworkBehavior:
      'Generates Discovery Questions for the user and marks the brief LOW-CONFIDENCE rather than fabricating detail; never resubmitted until the ambiguity is resolved or explicitly accepted as a logged assumption.',
    bossInteraction:
      'The Boss\u2019s independent reconstruction (§0.15) begins from this brief and the Domain Profile only \u2014 it does not read any downstream worker\u2019s output, so an error here propagates directly into the Boss\u2019s own expectation and is caught the next time the Boss re-derives it from source.',
    auditorInteraction:
      'Not directly challenged by the Red Team (§0.10), which operates on structural/behavioral/non-functional inventories; challenged instead by the Contradiction Analysis Worker if later artifacts imply a goal this brief did not state.',
    recursiveContribution:
      'Any Discovery Question this worker raises can trigger re-entry into Pass 1 once the user responds, before Pass 2 proceeds.',
    mpiContribution:
      'Seeds PROJECT-001, the root node every other artifact in the Master Product Inventory ultimately traces back to.',
  },
  {
    id: 'DW-A2',
    name: 'Domain Understanding Worker',
    cluster: 'A',
    responsibility:
      'Determine the industry/domain the product belongs to and pull the relevant conventions, vocabulary, and regulatory context from the Product DNA Library.',
    inputs: ['Product Understanding Brief (PROJECT-001)', 'Product DNA Library domain models'],
    outputs: ['Domain Profile: named domain, applicable regulatory frameworks, domain vocabulary, domain-specific workflow conventions'],
    evidenceRequired:
      'Each domain claim cites the Product DNA Library entry it was drawn from; each regulatory flag cites the specific requirement category it implies.',
    dependencies: ['Product Understanding Brief (DW-A1)'],
    verification: V,
    failureConditions: [
      'Domain misclassified',
      'A materially applicable regulatory framework omitted',
      'Vocabulary conflicts with the user\u2019s own stated terms without being flagged',
    ],
    reworkBehavior:
      'Returned to DW-A2 with the specific misclassification identified; a misclassified domain forces re-run of Pass 3 and Pass 4 downstream.',
    bossInteraction:
      'Boss independently classifies the domain from the same brief before comparing; a domain mismatch is a Priority-1 delta because every downstream genome inference depends on it.',
    auditorInteraction:
      'Red Team challenges under-scoped regulatory findings (Part 10 category: compliance) once the full inventory exists.',
    recursiveContribution:
      'A later-discovered feature (e.g., payments) can trigger DW-A2 to re-check for a regulatory framework not initially flagged (e.g., PCI-DSS).',
    mpiContribution:
      'Attaches the Domain Profile to PROJECT-001; this profile is a required citation for every Compliance Discovery Worker (DW-D6) finding.',
  },
  {
    id: 'DW-A3',
    name: 'Industry Pattern Research Worker',
    cluster: 'A',
    responsibility:
      'Survey mature, real-world products in the same category to build the raw material the Industry Comparison Engine (§0.9) evaluates for completeness gaps.',
    inputs: ['Category Classification (DW-A5)', 'Domain Profile (DW-A2)'],
    outputs: [
      'Industry Pattern Report: catalogue of common modules, workflows, administrative surfaces and conventions, each tagged with its source pattern',
    ],
    evidenceRequired:
      'Each pattern entry names the class of product it is drawn from and the specific capability observed; patterns are never asserted without a named category-level precedent.',
    dependencies: ['Category Classification (DW-A5)'],
    verification: V,
    failureConditions: [
      'Report reflects only one sub-style of the category without disclosing that scope limitation',
      'Patterns listed with no clear capability description',
    ],
    reworkBehavior:
      'Industry Comparison Engine bounces the report back if a pattern is too vague to evaluate as Required/Not-Required/Uncertain.',
    bossInteraction:
      'Not directly reconstructed by the Boss; the Boss checks that the Industry Comparison Engine\u2019s Add/Exclude/Question resolutions (§0.9) were applied to the Master Product Inventory.',
    auditorInteraction:
      'Red Team may independently propose patterns DW-A3 missed; both feed the same Industry Comparison Engine resolution queue.',
    recursiveContribution:
      'A pattern resolved \u2018Required\u2019 can trigger new Page, Feature, or Workflow Discovery passes exactly like a Red Team or Negative-Space finding.',
    mpiContribution:
      'Contributes evidence citations to any MPI artifact whose origin is industry-comparison rather than user statement or genome inference.',
  },
  {
    id: 'DW-A4',
    name: 'Business Model Discovery Worker',
    cluster: 'A',
    responsibility:
      'Determine how the product earns, what it commercially depends on, and what commercial risk it carries.',
    inputs: ['Product Understanding Brief (DW-A1)', 'Domain Profile (DW-A2)'],
    outputs: ['Business Model Brief: revenue mechanism(s), commercial dependencies, commercial risk flags'],
    evidenceRequired:
      'Each revenue mechanism and dependency must be either stated by the user or drawn from a named Product DNA Library pattern for this category \u2014 never invented.',
    dependencies: ['Product Understanding Brief (DW-A1)', 'Domain Profile (DW-A2)'],
    verification: V,
    failureConditions: [
      'Revenue mechanism assumed without evidence',
      'A commercial dependency (e.g., subscription billing) identified but not flagged to the Risk & Assumption Register',
    ],
    reworkBehavior: 'Unsupported revenue or dependency claims are stripped and reopened as Discovery Questions.',
    bossInteraction:
      'Boss checks that every commercial dependency named here has a corresponding Risk & Assumption Register (§0.20) entry before certifying Pass 1 complete.',
    auditorInteraction:
      'Red Team checks for uninvestigated commercial edge cases this brief implies (e.g., failed subscription renewal) once Feature Discovery (DW-B3) has run.',
    recursiveContribution:
      'A newly discovered commercial dependency can trigger re-entry into Feature Discovery for the supporting capability (e.g., billing failure handling).',
    mpiContribution:
      'Attaches business-model constraints to PROJECT-001; consumed by Module Discovery (DW-B2) and Feature Discovery (DW-B3).',
  },
  {
    id: 'DW-A5',
    name: 'Product Category Analysis Worker',
    cluster: 'A',
    responsibility:
      'Classify the product against the Application Genome Engine\u2019s category taxonomy so the correct genome and DNA-library baseline is applied.',
    inputs: ['Product Understanding Brief (DW-A1)', 'Application Genome Engine taxonomy'],
    outputs: ['Category Classification: primary category and, where applicable, secondary categories with a stated boundary'],
    evidenceRequired: 'Classification must cite the specific taxonomy definition matched, not merely a category label.',
    dependencies: ['Product Understanding Brief (DW-A1)'],
    verification: V,
    failureConditions: [
      'Product force-fit into a single category when it genuinely spans two',
      'Category chosen without citing the taxonomy definition',
    ],
    reworkBehavior:
      'Returned for re-classification; every downstream Application Genome Analysis (Pass 4) is blocked until this passes self-verification.',
    bossInteraction:
      'Boss independently classifies the category from the Product Understanding Brief before seeing this classification, then diffs \u2014 the §0.15 reconstruction discipline applied at the category level first.',
    auditorInteraction:
      'Red Team checks whether a secondary category was missed (e.g., a marketplace that is also, structurally, a CRM for sellers).',
    recursiveContribution:
      'A Red Team or Boss-identified secondary category re-triggers Pass 4 (Application Genome Analysis) for the added category.',
    mpiContribution:
      'Determines which Product DNA Library baseline every Structural (Cluster B) worker inherits.',
  },

  // --- Cluster B — Structural Discovery Workers ----------------------------
  {
    id: 'DW-B1',
    name: 'User/Role Discovery Worker',
    cluster: 'B',
    responsibility:
      'Identify every meaningful user role the product must support and what each role must be able to accomplish.',
    inputs: ['Product Understanding Brief (DW-A1)', 'Category Classification (DW-A5)', 'Application Genome output (Pass 4)'],
    outputs: ['Role Inventory, tagged ROLE-000n: role name, purpose, capability boundary'],
    evidenceRequired:
      'Each role cites either a direct user statement or a genome-inferred role typical of this category (e.g., \u2018Admin\u2019 inferred for any multi-tenant SaaS genome).',
    dependencies: ['Category Classification (DW-A5)', 'Application Genome Engine output'],
    verification: V,
    failureConditions: [
      'An operationally necessary role omitted',
      'Two roles defined with overlapping, unresolved capability boundaries',
    ],
    reworkBehavior:
      'Returned with the specific missing or overlapping role identified by would-be ROLE- ID; re-verified against the updated Workflow Inventory (DW-B4) once workflows are discovered.',
    bossInteraction:
      'Boss independently derives the expected role set from the genome and domain before comparing against the Role Inventory by ID.',
    auditorInteraction:
      'Red Team probes specifically for administrative and operational roles (e.g., \u2018Auditor\u2019, \u2018Billing Admin\u2019) that functional-only thinking omits.',
    recursiveContribution:
      'Every new Feature or Workflow discovered later is checked against the Role Inventory for an implied-but-absent role (Pass 21 re-entry).',
    mpiContribution: 'ROLE-000n entries are required parents for every Permission Discovery (DW-C6) finding.',
  },
  {
    id: 'DW-B2',
    name: 'Module Discovery Worker',
    cluster: 'B',
    responsibility:
      'Discover the product\u2019s modules \u2014 the top-level functional groupings the rest of Structural Discovery organizes beneath.',
    inputs: ['Business Model Brief (DW-A4)', 'Role Inventory (DW-B1)', 'Application Genome output'],
    outputs: ['Module Inventory, tagged MODULE-000n'],
    evidenceRequired:
      'Each module cites either a direct user statement, a genome inference, or an Industry Comparison resolution (§0.9).',
    dependencies: ['Role Inventory (DW-B1)', 'Application Genome Engine output'],
    verification: V,
    failureConditions: [
      'A module genome-implied by the category is missing',
      'Two modules defined with unclear ownership of a shared capability',
    ],
    reworkBehavior: 'Missing module reopens Pass 7 for the specific module only, not the full inventory.',
    bossInteraction: 'Boss reconstructs the expected module list independently from the genome before diffing by MODULE- ID.',
    auditorInteraction:
      'Red Team challenges module boundaries specifically for administrative and operational modules (Settings, Audit, Billing).',
    recursiveContribution: 'A module accepted from Negative-Space Discovery (§0.11) re-enters Pass 7/8 for its own Feature Discovery sweep.',
    mpiContribution: 'MODULE-000n is the direct parent of every FEATURE-000n artifact.',
  },
  {
    id: 'DW-B3',
    name: 'Feature Discovery Worker',
    cluster: 'B',
    responsibility: 'Discover the features within every module.',
    inputs: ['Module Inventory (DW-B2)', 'Application Genome output', 'Business Model Brief (DW-A4)'],
    outputs: ['Feature Inventory, tagged FEATURE-000n, each with a parent MODULE-000n reference'],
    evidenceRequired: 'Each feature cites its source: user statement, genome inference, or industry comparison resolution.',
    dependencies: ['Module Inventory (DW-B2)'],
    verification: V,
    failureConditions: [
      'A feature exists with no parent module',
      'A feature genome-implied by its module is missing',
    ],
    reworkBehavior: 'Orphan features are reparented or rejected; missing genome-implied features reopen Pass 8 for that module only.',
    bossInteraction: 'Boss reconstructs the expected feature list per module independently before diffing by ID \u2014 the level of the §1.4 worked example.',
    auditorInteraction:
      'Red Team\u2019s primary target: proposes features the corps is structurally likely to miss (recovery, bulk operations, audit, export) per module.',
    recursiveContribution:
      'Feature Family Expansion (§0.7, Pass 11) re-enters this worker\u2019s output to generate each feature\u2019s full supporting ecosystem.',
    mpiContribution: 'FEATURE-000n is the direct parent of every PAGE-000n and WORKFLOW-000n that implements it.',
  },
  {
    id: 'DW-B4',
    name: 'Workflow Discovery Worker',
    cluster: 'B',
    responsibility: 'Discover all major and supporting workflows that connect features into a working product.',
    inputs: ['Feature Inventory (DW-B3)', 'Role Inventory (DW-B1)'],
    outputs: ['Workflow Inventory, tagged WORKFLOW-000n, each naming participating roles and connected features'],
    evidenceRequired:
      'Each workflow cites the features and roles it connects by ID; a workflow with only one participating role is flagged for review.',
    dependencies: ['Feature Inventory (DW-B3)', 'Role Inventory (DW-B1)'],
    verification: V,
    failureConditions: [
      'A feature exists with no workflow that exercises it (an \u2018orphan feature\u2019 per Pass 20)',
      'A workflow references a role not present in the Role Inventory',
    ],
    reworkBehavior:
      'Orphan features are routed back to DW-B4 to either produce the missing workflow or justify why none is needed (e.g., a pure configuration feature).',
    bossInteraction: 'Boss derives the expected workflow set from the Feature and Role Inventories before diffing by WORKFLOW- ID.',
    auditorInteraction: 'Red Team hunts for approval chains, escalation paths, and multi-role handoffs that single-role thinking omits.',
    recursiveContribution:
      'Every workflow discovered here is a required input to Edge-Case Discovery (DW-D1) and Recursive Page Expansion Layer 3 (Interactions).',
    mpiContribution: 'WORKFLOW-000n entries connect ROLE-, FEATURE-, and PAGE- nodes into the graph\u2019s process layer.',
  },
  {
    id: 'DW-B5',
    name: 'Page Discovery Worker',
    cluster: 'B',
    responsibility:
      'Discover every page, sub-page, dashboard, settings surface, admin surface, error experience, and other supporting experience the product requires.',
    inputs: ['Feature Inventory (DW-B3)', 'Workflow Inventory (DW-B4)'],
    outputs: ['Page Inventory, tagged PAGE-00nn, each with parent FEATURE-000n'],
    evidenceRequired: 'Each page cites the feature or workflow step it exists to serve.',
    dependencies: ['Feature Inventory (DW-B3)', 'Workflow Inventory (DW-B4)'],
    verification: V,
    failureConditions: [
      'A feature has no page surfacing it and no documented reason',
      'A page exists that serves no feature or workflow (orphan, Pass 20)',
    ],
    reworkBehavior: 'Missing pages reopen Pass 9 for the specific feature; orphan pages are reparented or rejected.',
    bossInteraction:
      'Boss reconstructs the expected page count and identity per feature/module before diffing \u2014 the primary artifact in the §1.4 worked example (200 vs. 203 pages, by ID).',
    auditorInteraction:
      'Red Team\u2019s highest-value target \u2014 administrative, error, and edge-state pages (bulk-action confirmation, session-expired, empty-search-results).',
    recursiveContribution: 'Every certified page immediately enters Pass 10, Recursive Page Expansion (§0.6).',
    mpiContribution: 'PAGE-00nn is the anchor artifact for the entire Recursive Page Expansion layer stack.',
  },
  {
    id: 'DW-B6',
    name: 'Modal/Dialog Discovery Worker',
    cluster: 'B',
    responsibility:
      'Discover every modal, dialog, and wizard the product requires \u2014 surfaces that live inside a page\u2019s flow rather than as independently navigable pages.',
    inputs: ['Page Inventory (DW-B5)', 'Interaction Discovery Worker (DW-C2) preliminary findings'],
    outputs: ['Modal/Dialog Inventory, tagged PAGE-00nn-MODAL-0n, parented to the triggering page'],
    evidenceRequired: 'Each modal cites the specific interaction (e.g., \u2018Delete Customer\u2019 action) that triggers it.',
    dependencies: ['Page Inventory (DW-B5)'],
    verification: V,
    failureConditions: [
      'A destructive action (delete, bulk-cancel) has no confirmation modal',
      'A multi-step process is missing its wizard decomposition',
    ],
    reworkBehavior:
      'Missing confirmation modals for destructive actions are treated as a Security/Edge-Case cross-finding and routed jointly to DW-B6 and DW-D1.',
    bossInteraction:
      'Boss checks that every destructive Interaction (Layer 3) artifact has a corresponding confirmation modal before certifying the page complete.',
    auditorInteraction:
      'Red Team probes for missing multi-step wizard decomposition on complex creation flows.',
    recursiveContribution:
      'A newly discovered modal is itself subject to Recursive Page Expansion Layers 2\u20137 at a reduced but non-zero scope.',
    mpiContribution: 'PAGE-00nn-MODAL-0n nodes are children of their triggering page and parents of their own Content/Action/State artifacts.',
  },
  {
    id: 'DW-B7',
    name: 'Dashboard Discovery Worker',
    cluster: 'B',
    responsibility: 'Discover every dashboard and its reporting surfaces.',
    inputs: ['Module Inventory (DW-B2)', 'Role Inventory (DW-B1)'],
    outputs: ['Dashboard Inventory, tagged PAGE-00nn (specialized content profile) plus REPORT-000n children'],
    evidenceRequired: 'Each dashboard cites the role(s) it serves and the decisions that role needs the dashboard to support.',
    dependencies: ['Role Inventory (DW-B1)', 'Module Inventory (DW-B2)'],
    verification: V,
    failureConditions: [
      'A role with clear operational responsibility has no dashboard',
      'A dashboard exists with metrics that trace to no underlying data entity',
    ],
    reworkBehavior:
      'Metrics with no traceable data entity are routed to Database/Data Discovery (DW-B9) to confirm the entity exists or should be added.',
    bossInteraction:
      'Boss checks role-to-dashboard coverage specifically, since an operationally necessary role with no dashboard is a common, easily-missed gap.',
    auditorInteraction:
      'Red Team challenges whether each dashboard\u2019s metrics are the metrics that role actually needs, not merely metrics that are easy to compute.',
    recursiveContribution: 'A dashboard metric with no backing entity triggers re-entry into Database/Data Discovery.',
    mpiContribution: 'REPORT-000n nodes cite the ENTITY-000n nodes (DW-B9) their metrics are computed from.',
  },
  {
    id: 'DW-B8',
    name: 'Form Discovery Worker',
    cluster: 'B',
    responsibility: 'Discover every form and its fields across the product.',
    inputs: ['Page Inventory (DW-B5)', 'Feature Inventory (DW-B3)'],
    outputs: ['Form Inventory, tagged PAGE-00nn-FORM-0n, each with a field list'],
    evidenceRequired:
      'Each field cites the entity attribute it maps to (DW-B9) or is flagged as computed/derived.',
    dependencies: ['Page Inventory (DW-B5)', 'Coordinates with Database/Data Discovery (DW-B9)'],
    verification: V,
    failureConditions: [
      'A field with no corresponding entity attribute and no \u2018derived\u2019 justification',
      'An entity attribute with no form that can set it',
    ],
    reworkBehavior:
      'Unmapped fields returned to DW-B8/DW-B9 jointly for reconciliation before Validation Discovery (DW-C4) can run against the form.',
    bossInteraction: 'Boss cross-checks field-to-entity-attribute coverage bidirectionally, not just form-by-form.',
    auditorInteraction:
      'Red Team checks for missing bulk-entry and import-based alternatives to manual form entry, where genome-typical for the category.',
    recursiveContribution: 'Every certified form becomes a required input to Validation Discovery (DW-C4).',
    mpiContribution: 'PAGE-00nn-FORM-0n nodes are the direct parent of VALIDATION-00nn-0n nodes.',
  },
  {
    id: 'DW-B9',
    name: 'Database/Data Discovery Worker',
    cluster: 'B',
    responsibility: 'Discover every database entity, relationship, and data dependency the product requires.',
    inputs: ['Feature Inventory (DW-B3)', 'Form Inventory (DW-B8)', 'Dashboard Inventory (DW-B7)'],
    outputs: ['Entity Inventory, tagged ENTITY-000n, with relationships to other entities'],
    evidenceRequired: 'Each entity cites the feature(s) that create, read, update, or delete it.',
    dependencies: ['Feature Inventory (DW-B3)'],
    verification: V,
    failureConditions: [
      'An entity with no CRUD consumer anywhere in the Feature Inventory (orphan, Pass 20)',
      'A relationship implied by two entities\u2019 fields but not modeled',
    ],
    reworkBehavior: 'Orphan entities are reparented to a feature or rejected; unmodeled relationships are returned for explicit definition.',
    bossInteraction: 'Boss derives the expected entity set from the genome-typical data model for this category before diffing by ENTITY- ID.',
    auditorInteraction: 'Red Team checks for missing audit/history entities (e.g., no \u2018OrderStatusHistory\u2019 behind a status field).',
    recursiveContribution: 'A newly required entity re-triggers API Discovery (DW-B10) for its CRUD surface.',
    mpiContribution: 'ENTITY-000n nodes are required citations for every API-000n, VALIDATION-, and REPORT- node.',
  },
  {
    id: 'DW-B10',
    name: 'API Discovery Worker',
    cluster: 'B',
    responsibility: 'Discover every API and event the product requires.',
    inputs: ['Entity Inventory (DW-B9)', 'Interaction Discovery Worker (DW-C2) preliminary findings'],
    outputs: ['API Inventory, tagged API-000n, each mapped to the entity/entities it operates on and the interaction(s) that call it'],
    evidenceRequired: 'Each API cites the entity it operates on and the calling interaction; each event cites its trigger and subscriber(s).',
    dependencies: ['Entity Inventory (DW-B9)'],
    verification: V,
    failureConditions: [
      'An entity with no full CRUD API surface and no documented reason',
      'An interaction that implies an API call with no corresponding API artifact',
    ],
    reworkBehavior: 'Missing API coverage is returned to DW-B10 with the specific entity/operation gap identified.',
    bossInteraction:
      'Boss checks entity-to-API coverage completeness as a matrix \u2014 every entity\u2019s expected operation set is checked individually.',
    auditorInteraction: 'Red Team checks for missing bulk/batch API operations and missing webhook/event surfaces for integration-heavy categories.',
    recursiveContribution: 'A newly discovered API can imply a new Integration Discovery (DW-B11) target if it serves an external consumer.',
    mpiContribution: 'API-000n nodes are the primary bridge between the Master Product Inventory and Stage 2 Build artifacts.',
  },
  {
    id: 'DW-B11',
    name: 'Integration Discovery Worker',
    cluster: 'B',
    responsibility: 'Discover every third-party and internal integration the product requires.',
    inputs: ['Business Model Brief (DW-A4)', 'API Inventory (DW-B10)', 'Domain Profile (DW-A2)'],
    outputs: ['Integration Inventory, tagged INTEGRATION-000n, each with purpose, direction, and touched entities'],
    evidenceRequired:
      'Each integration cites a direct user statement, a business-model dependency, or a domain-standard integration for this category.',
    dependencies: ['Business Model Brief (DW-A4)', 'API Inventory (DW-B10)'],
    verification: V,
    failureConditions: [
      'A business-model dependency with no corresponding integration artifact',
      'An integration with no failure-handling requirement flagged to Edge-Case Discovery',
    ],
    reworkBehavior: 'Missing integrations reopen Pass 13 (Dependency Discovery) for the specific commercial dependency.',
    bossInteraction: 'Boss cross-checks every Business Model Brief dependency against the Integration Inventory line by line.',
    auditorInteraction: 'Red Team checks integration failure/degradation handling as a Negative-Space consequence.',
    recursiveContribution: 'Every integration triggers a mandatory Edge-Case Discovery sweep (DW-D1) for its failure modes.',
    mpiContribution: 'INTEGRATION-000n nodes are required inputs to Operational Discovery (DW-D5) and the Stage 4 deployment verification chain.',
  },

  // --- Cluster C — Behavioral Discovery Workers -----------------------------
  {
    id: 'DW-C1',
    name: 'Page Content Discovery Worker',
    cluster: 'C',
    responsibility:
      'Discover every content region within each page \u2014 cards, tables, lists, charts, status indicators, information blocks \u2014 as Layer 2 of Recursive Page Expansion (§0.6).',
    inputs: ['Page Inventory (DW-B5)', 'Entity Inventory (DW-B9)'],
    outputs: ['Content Inventory, tagged PAGE-00nn-SECTION-0n-CONTENT-0nn'],
    evidenceRequired: 'Each content item cites the entity/data it displays and the purpose it serves on that page.',
    dependencies: ['Page Inventory (DW-B5)'],
    verification: V,
    failureConditions: ['A page\u2019s stated purpose implies a content region that is not present'],
    reworkBehavior: 'Missing content regions reopen Layer 2 for the specific page only.',
    bossInteraction:
      'Boss derives the expected content inventory per page from its stated purpose and entity data before diffing by ID; checks Identity and Quality, not only Count (§0.16).',
    auditorInteraction: 'Red Team challenges content completeness against the Industry Comparison Engine\u2019s findings for equivalent pages.',
    recursiveContribution: 'Every certified content item proceeds to Interaction Discovery (DW-C2) for available actions.',
    mpiContribution: 'CONTENT-0nn nodes are the most numerous class of artifact and the subject of the §1.4 Boss-reconstruction example.',
  },
  {
    id: 'DW-C2',
    name: 'Interaction Discovery Worker',
    cluster: 'C',
    responsibility: 'Discover every user action available on every content item, form, and page \u2014 Layer 3 of Recursive Page Expansion.',
    inputs: ['Content Inventory (DW-C1)', 'Business Rule Discovery Worker (DW-C5) preliminary findings'],
    outputs: [
      'Interaction Inventory, tagged ACTION-0nn-0n, from the standing action vocabulary (create, edit, delete, search, filter, sort, export, import, upload, download, approve, reject, archive, restore, assign, invite, cancel, retry) plus category-specific actions',
    ],
    evidenceRequired:
      'Each action cites the permission tier it requires (pending DW-C6) and the state transition it causes.',
    dependencies: ['Content Inventory (DW-C1)'],
    verification: V,
    failureConditions: [
      'A destructive action has no corresponding confirmation Modal (cross-checked against DW-B6)',
      'An action is listed with no defined resulting State',
    ],
    reworkBehavior: 'Actions with no defined resulting state are returned jointly to DW-C2 and State Discovery (DW-C3).',
    bossInteraction:
      'Boss checks that the action set matches what the page\u2019s purpose and role permissions imply \u2014 a \u2018view + edit\u2019 inventory on an approval-authority page is rejected.',
    auditorInteraction: 'Red Team hunts for missing bulk-action variants (bulk-approve, bulk-export) on list/table content.',
    recursiveContribution: 'Every certified action proceeds to State Discovery (DW-C3) and Validation Discovery (DW-C4).',
    mpiContribution: 'ACTION-0nn-0n nodes are the parent of their corresponding STATE- and VALIDATION- nodes.',
  },
  {
    id: 'DW-C3',
    name: 'State Discovery Worker',
    cluster: 'C',
    responsibility: 'Discover every relevant state per surface and action \u2014 Layer 4 of Recursive Page Expansion.',
    inputs: ['Interaction Inventory (DW-C2)', 'Edge-Case Discovery Worker (DW-D1) preliminary findings'],
    outputs: [
      'State Inventory, tagged STATE-0nn-0n-0n, drawn from the standing state vocabulary (initial, loading, empty, success, error, unauthorized, forbidden, not-found, disabled, processing, pending, expired, offline, partially-failed, retrying, locked, archived) filtered to relevance',
    ],
    evidenceRequired: 'Each state cites the specific action or condition that produces it; states are never added by default without a triggering condition.',
    dependencies: ['Interaction Inventory (DW-C2)'],
    verification: V,
    failureConditions: [
      'An action with an async/network dependency has no loading or error state defined',
      'A state is defined that no action or condition can actually produce (over-inclusion, §0.16 Quality/Duplication)',
    ],
    reworkBehavior: 'Missing async states are returned to DW-C3; unreachable states are removed and logged as a self-verification correction.',
    bossInteraction:
      'Boss checks state coverage against the action\u2019s technical profile (does it call an API? touch an integration?) rather than a blanket template.',
    auditorInteraction: 'Red Team probes for concurrency and partial-failure states (two users editing the same record; a bulk action that partially succeeds).',
    recursiveContribution: 'Every certified error/failure state is cross-checked against Edge-Case Discovery (DW-D1) for a matching entry, and vice versa.',
    mpiContribution: 'STATE- nodes are required inputs to Stage 3 Testing\u2019s derived coverage requirement.',
  },
  {
    id: 'DW-C4',
    name: 'Validation Discovery Worker',
    cluster: 'C',
    responsibility: 'Discover every validation rule, client- and server-side \u2014 Layer 5 of Recursive Page Expansion.',
    inputs: ['Form Inventory (DW-B8)', 'Entity Inventory (DW-B9)', 'Business Rule Discovery Worker (DW-C5) preliminary findings'],
    outputs: [
      'Validation Inventory, tagged VALIDATION-00nn-0n: required fields, format rules, duplicate checks, cross-field rules, server/business/permission/state validation',
    ],
    evidenceRequired: 'Each validation cites the field(s) or entity constraint it enforces and whether it is client-side, server-side, or both.',
    dependencies: ['Form Inventory (DW-B8)'],
    verification: V,
    failureConditions: [
      'A field marked required in the Entity Inventory has no corresponding validation rule',
      'A cross-field business rule is not represented as a validation',
    ],
    reworkBehavior: 'Missing validations reopen Layer 5 for the specific form.',
    bossInteraction: 'Boss cross-checks every required entity attribute against the Validation Inventory as a matrix, the same discipline as DW-B10.',
    auditorInteraction: 'Red Team probes for missing server-side validation duplicating client-side rules (a production vulnerability, not only a completeness gap).',
    recursiveContribution: 'A validation discovered here that reveals an unmodeled business rule re-triggers Business Rule Discovery (DW-C5).',
    mpiContribution: 'VALIDATION- nodes are required test-case inputs for Stage 3 Testing\u2019s derived coverage.',
  },
  {
    id: 'DW-C5',
    name: 'Business Rule Discovery Worker',
    cluster: 'C',
    responsibility: 'Discover the rules governing every action and state across the product \u2014 Layer 6 of Recursive Page Expansion.',
    inputs: ['Interaction Inventory (DW-C2)', 'State Inventory (DW-C3)', 'Domain Profile (DW-A2)'],
    outputs: ['Business Rule Inventory, tagged RULE-000n, each citing the action(s)/state(s) it governs'],
    evidenceRequired:
      'Each rule cites a user statement, a domain-standard convention, or an explicit inference \u2014 inferred consequential rules are flagged for confirmation via a Discovery Question.',
    dependencies: ['Interaction Inventory (DW-C2)', 'Domain Profile (DW-A2)'],
    verification: V,
    failureConditions: [
      'An approval workflow (DW-B4) has no rule defining who can approve or under what condition',
      'Two rules apply to the same action with contradictory conditions',
    ],
    reworkBehavior: 'Contradictions are routed immediately to the Contradiction Engine (§0.19, DW-E2) rather than resolved unilaterally by this worker.',
    bossInteraction: 'Boss checks that every Workflow with an approval or gating step has a governing rule, since ungoverned gates are a common silent gap.',
    auditorInteraction: 'Red Team probes for rule interactions across roles (does a rule for \u2018Manager\u2019 account for a user holding two roles?).',
    recursiveContribution: 'A newly discovered rule can imply a new Permission (DW-C6) or a new State (DW-C3, e.g., \u2018pending approval\u2019).',
    mpiContribution: 'RULE-000n nodes are cited by every ACTION- and STATE- node they govern, and are the primary input to the Contradiction Engine (§0.19).',
  },
  {
    id: 'DW-C6',
    name: 'Permission Discovery Worker',
    cluster: 'C',
    responsibility:
      'Discover who may view, create, edit, delete, approve, reject, export, or access sensitive data or administrative actions, per surface \u2014 Layer 7 of Recursive Page Expansion.',
    inputs: ['Role Inventory (DW-B1)', 'Interaction Inventory (DW-C2)', 'Business Rule Inventory (DW-C5)'],
    outputs: ['Permission Inventory, tagged PERMISSION-000n, mapped ROLE-000n \u00d7 ACTION-0nn-0n'],
    evidenceRequired:
      'Each grant or denial cites a user statement or a role-capability-boundary inference from the Role Inventory; sensitive-data access is always evidenced by a citation to a Security Discovery (DW-D2) finding.',
    dependencies: ['Role Inventory (DW-B1)', 'Interaction Inventory (DW-C2)'],
    verification: V,
    failureConditions: [
      'An action exists with no permission mapping for any role (silently allowing or silently blocking everyone \u2014 both errors)',
      'Two roles are granted contradictory access to the same sensitive action',
    ],
    reworkBehavior: 'Contradictory grants are routed to the Contradiction Engine (§0.19); unmapped actions are returned to DW-C6.',
    bossInteraction:
      'Boss reconstructs the expected permission matrix independently from the Role Inventory\u2019s stated boundaries before diffing cell-by-cell \u2014 checked as a full matrix, not spot-checked.',
    auditorInteraction: 'Red Team\u2019s standing example finding: a business rule and a permission entry that contradict each other on who may delete a resource (§0.19).',
    recursiveContribution: 'Every certified permission is a required input to Security Discovery (DW-D2).',
    mpiContribution: 'PERMISSION-000n nodes are required verification inputs for Stage 3 permission-testing coverage and are audited on every Safe Change Intelligence impact analysis.',
  },
  {
    id: 'DW-C7',
    name: 'Notification Discovery Worker',
    cluster: 'C',
    responsibility: 'Discover every notification, its trigger, and its recipients.',
    inputs: ['Workflow Inventory (DW-B4)', 'State Inventory (DW-C3)', 'Business Rule Inventory (DW-C5)'],
    outputs: ['Notification Inventory, tagged NOTIFICATION-000n: trigger event, recipient role(s), channel, content summary'],
    evidenceRequired: 'Each notification cites the triggering state transition or rule and the role(s) that need to know about it.',
    dependencies: ['Workflow Inventory (DW-B4)', 'State Inventory (DW-C3)'],
    verification: V,
    failureConditions: [
      'An approval-chain workflow step completes with no notification to the next approver',
      'A failure state (payment failure, integration failure) has no user-facing notification',
    ],
    reworkBehavior: 'Missing notifications on approval or failure transitions are Priority-1 and reopen this pass immediately rather than waiting for the next sweep.',
    bossInteraction: 'Boss checks every multi-role Workflow for a complete handoff-notification chain, since a missing notification silently breaks an otherwise complete workflow.',
    auditorInteraction: 'Red Team checks failure and expiration states for missing notifications, since these are more often forgotten than success-path notifications.',
    recursiveContribution: 'A notification discovered here can imply a Settings/Preferences feature (notification preferences) routed back to DW-B3.',
    mpiContribution: 'NOTIFICATION-000n nodes are required inputs to Operational Discovery (DW-D5) for delivery-channel monitoring.',
  },
  {
    id: 'DW-C8',
    name: 'Dependency Discovery Worker',
    cluster: 'C',
    responsibility: 'Discover everything one artifact implies about another across the entire Master Product Inventory \u2014 the cross-cutting dependency map, run as Pass 13.',
    inputs: ['The full Master Product Inventory as certified through Pass 12'],
    outputs: ['Dependency Map, cross-referencing every artifact\u2019s depends_on / depended_on_by metadata fields (§0.13)'],
    evidenceRequired: 'Each dependency edge cites the specific mechanism of dependence (e.g., \u2018ACTION-0042-03 depends on INTEGRATION-0007 because it calls the payment processor\u2019).',
    dependencies: ['All Cluster B and Cluster C workers\u2019 certified output through Pass 12'],
    verification: V,
    failureConditions: [
      'A dependency edge exists in one direction but not the reciprocal',
      'A dependency chain terminates in an artifact that does not exist',
    ],
    reworkBehavior: 'Broken or one-directional edges are returned to the artifact\u2019s owning worker for correction; this worker records dependencies, it does not resolve gaps on other workers\u2019 artifacts.',
    bossInteraction: 'Boss spot-audits dependency chains by walking them end-to-end for a sample of high-fan-out artifacts.',
    auditorInteraction: 'Red Team looks for circular dependencies and single points of failure (one Integration the Feature Inventory silently depends on with no fallback).',
    recursiveContribution: 'A broken dependency chain is a required exit criterion for Pass 21; the sweep cannot close while any chain is broken.',
    mpiContribution: 'The Dependency Map is the machine-checkable backbone of the graph\u2019s \u2018nothing exists in isolation\u2019 guarantee (§0.2).',
  },

  // --- Cluster D — Non-Functional Discovery Workers -------------------------
  {
    id: 'DW-D1',
    name: 'Edge-Case Discovery Worker',
    cluster: 'D',
    responsibility: 'Run the standing edge-case question set (§0.8) against every feature, page, action, and workflow to surface failure and abnormal conditions.',
    inputs: ['Feature Inventory (DW-B3)', 'Interaction Inventory (DW-C2)', 'Integration Inventory (DW-B11)'],
    outputs: ['Edge-Case Register, tagged EDGECASE-000n, each routed to the artifact type it implies (state, dialog, notification, rule, or new page)'],
    evidenceRequired: 'Each edge case cites the specific standing question (§0.8) it answers and the artifact it was routed to.',
    dependencies: ['Interaction Inventory (DW-C2)', 'Integration Inventory (DW-B11) for third-party failure modes'],
    verification: V,
    failureConditions: [
      'A payment-bearing workflow has no entry for payment failure/pending/reversal',
      'A multi-step workflow has no entry for abandonment mid-flow',
    ],
    reworkBehavior: 'Missing edge cases for payment, concurrency, and abandonment are Priority-1 and block Pass 12 exit specifically.',
    bossInteraction: 'Boss independently applies the standing question set to the highest-risk workflows (payment, irreversible actions, multi-step processes) before comparing to this register.',
    auditorInteraction: 'Works in tandem with the Discovery Red Team (DW-E4): this worker runs the standing question set systematically; the Red Team probes for edge cases the standing set does not anticipate.',
    recursiveContribution: 'Every routed edge case (a new state, dialog, or notification) re-enters the relevant Cluster C worker\u2019s pass.',
    mpiContribution: 'EDGECASE-000n entries are required inputs to Stage 3 Testing\u2019s failure-condition coverage.',
  },
  {
    id: 'DW-D2',
    name: 'Security Discovery Worker',
    cluster: 'D',
    responsibility: 'Discover security boundaries, sensitive operations, authorization requirements, and injection/abuse risk across the product.',
    inputs: ['Permission Inventory (DW-C6)', 'API Inventory (DW-B10)', 'Entity Inventory (DW-B9)'],
    outputs: ['Security Requirement Set, tagged SECURITY-000n: authentication requirements, sensitive-data handling rules, audit requirements, session behavior'],
    evidenceRequired: 'Each requirement cites the specific artifact (API, entity field, or action) it constrains.',
    dependencies: ['Permission Inventory (DW-C6)', 'API Inventory (DW-B10)'],
    verification: V,
    failureConditions: [
      'An API that writes a sensitive entity field has no audit-logging requirement attached',
      'A session-bound action has no session-expiry behavior defined',
    ],
    reworkBehavior: 'Sensitive-data APIs with no audit requirement are Priority-1 and block Pass 14 exit.',
    bossInteraction: 'Boss derives the expected security requirement set from the Permission Inventory plus the Foundational Intelligence Layer\u2019s regulatory/security patterns (reasoned directly, not through the Domain Profile) before diffing.',
    auditorInteraction: 'Primary Red Team collaboration point: the Red Team explicitly probes this output for unhandled sensitive operations and privilege-boundary gaps.',
    recursiveContribution: 'A newly discovered sensitive operation re-triggers Permission Discovery (DW-C6) confirmation.',
    mpiContribution: 'SECURITY-000n entries are mandatory inputs to Stage 2 Build\u2019s implementation review and Stage 3 Testing\u2019s security-testing coverage.',
  },
  {
    id: 'DW-D3',
    name: 'Accessibility Discovery Worker',
    cluster: 'D',
    responsibility: 'Discover keyboard, screen-reader, and semantic requirements per surface \u2014 Layer 9 of Recursive Page Expansion.',
    inputs: ['Content Inventory (DW-C1)', 'Interaction Inventory (DW-C2)'],
    outputs: ['Accessibility Requirement Set, tagged A11Y-00nn-0n: keyboard path, focus management, labeling, screen-reader behavior per interactive element'],
    evidenceRequired: 'Each requirement cites the specific interactive content element it governs.',
    dependencies: ['Content Inventory (DW-C1)', 'Interaction Inventory (DW-C2)'],
    verification: V,
    failureConditions: [
      'An interactive element (custom dropdown, modal, drag-and-drop) has no keyboard-equivalent interaction defined',
      'A dynamic content update has no screen-reader announcement requirement',
    ],
    reworkBehavior: 'Missing keyboard-equivalents for custom interactive components are Priority-1 and block Pass 14 exit.',
    bossInteraction: 'Boss spot-checks accessibility coverage on every custom (non-standard-form) interactive component, since standard fields inherit baseline accessibility from the Product DNA Library while custom components do not.',
    auditorInteraction: 'Red Team checks accessibility requirements on modals and dynamic content (DW-B6, DW-C3 states), the most commonly under-specified category.',
    recursiveContribution: 'Not typically a source of new structural artifacts; findings attach directly to existing Content/Interaction nodes.',
    mpiContribution: 'A11Y- entries are mandatory inputs to Stage 3 Testing\u2019s accessibility-testing coverage.',
  },
  {
    id: 'DW-D4',
    name: 'Performance Discovery Worker',
    cluster: 'D',
    responsibility: 'Discover loading, pagination, caching, and scale expectations per surface \u2014 Layer 12 of Recursive Page Expansion.',
    inputs: ['Content Inventory (DW-C1)', 'Entity Inventory (DW-B9) with expected record-volume signals from the Domain Profile'],
    outputs: ['Performance Requirement Set, tagged PERF-00nn-0n: pagination/virtualization, caching strategy, expensive-operation flags'],
    evidenceRequired: 'Each requirement cites the specific content list or operation it constrains and the volume assumption it is based on.',
    dependencies: ['Content Inventory (DW-C1)', 'Entity Inventory (DW-B9)'],
    verification: V,
    failureConditions: [
      'A list-type content region backed by an entity with no volume ceiling has no pagination or virtualization requirement',
      'An expensive operation (bulk export, report generation) has no async/background-job requirement',
    ],
    reworkBehavior: 'Missing pagination requirements on unbounded lists are Priority-1.',
    bossInteraction: 'Boss checks every list-type Content node against its backing Entity for a stated or inferred volume assumption before accepting the absence of a pagination requirement.',
    auditorInteraction: 'Red Team checks for missing caching/rate-limit requirements on API endpoints exposed to bulk operations.',
    recursiveContribution: 'A flagged expensive operation can imply a new background-job Feature not yet in the Feature Inventory \u2014 routed to DW-B3.',
    mpiContribution: 'PERF- entries are mandatory inputs to Stage 3 performance-testing coverage and Stage 4 capacity monitoring.',
  },
  {
    id: 'DW-D5',
    name: 'Operational Discovery Worker',
    cluster: 'D',
    responsibility: 'Discover monitoring, logging, auditing, backup, and recovery needs across the product.',
    inputs: ['Integration Inventory (DW-B11)', 'Security Requirement Set (DW-D2)', 'Notification Inventory (DW-C7)'],
    outputs: ['Operational Requirement Set, tagged OPS-000n: monitoring targets, log retention, backup cadence, RPO/RTO expectations'],
    evidenceRequired: 'Each requirement cites the specific integration, entity, or sensitive operation it exists to protect.',
    dependencies: ['Integration Inventory (DW-B11)', 'Security Requirement Set (DW-D2)'],
    verification: V,
    failureConditions: [
      'A critical third-party integration (DW-B11) has no monitoring target defined',
      'A sensitive entity has no backup/recovery requirement',
    ],
    reworkBehavior: 'Missing monitoring on Priority-1 integrations blocks Pass 15 exit.',
    bossInteraction: 'Boss independently derives the expected operational baseline for this category from the Product DNA Library before diffing against DW-D5\u2019s output \u2014 the specification Stage 4 is later built and verified against.',
    auditorInteraction: 'Red Team checks for missing disaster-recovery requirements on any entity the Business Model Brief (DW-A4) identifies as commercially critical.',
    recursiveContribution: 'Not typically generative of new structural artifacts; consumes and constrains Stage 4 directly.',
    mpiContribution: 'OPS-000n entries are the direct specification input to Stage 4\u2019s Deployment & Operations Boss.',
  },
  {
    id: 'DW-D6',
    name: 'Compliance Discovery Worker',
    cluster: 'D',
    responsibility: 'Discover applicable regulatory and standards requirements for this product.',
    inputs: ['Domain Profile (DW-A2)', 'Entity Inventory (DW-B9) for regulated data classes (PII, payment data, health data)'],
    outputs: ['Compliance Requirement Set, tagged COMPLIANCE-000n, each citing the regulation/standard and the entity or operation it governs'],
    evidenceRequired: 'Each requirement cites a named regulation or standard from the Domain Profile \u2014 never a generic \u2018best practice\u2019 claim without a named source.',
    dependencies: ['Domain Profile (DW-A2)', 'Entity Inventory (DW-B9)'],
    verification: V,
    failureConditions: [
      'An entity storing regulated data has no corresponding compliance requirement',
      'A compliance requirement is stated with no entity or operation it actually governs',
    ],
    reworkBehavior: 'Regulated-data entities with no compliance coverage are Priority-1 and block Pass 14 exit alongside Security Discovery.',
    bossInteraction: 'Boss cross-checks the Domain Profile\u2019s regulatory flags against the Entity Inventory\u2019s data classifications as a matrix, the same discipline as DW-C6.',
    auditorInteraction: 'Red Team checks for compliance requirements that apply to a secondary category (DW-A5) that the primary-category sweep may have missed.',
    recursiveContribution: 'A newly identified compliance requirement can imply new Security (DW-D2) or Operational (DW-D5) requirements.',
    mpiContribution: 'COMPLIANCE-000n entries are mandatory citations in Blueprint Completeness Certification (§0.23) and are re-checked on every post-launch change to a regulated entity.',
  },
  {
    id: 'DW-D7',
    name: 'Documentation Discovery Worker',
    cluster: 'D',
    responsibility: 'Discover required user-facing and internal documentation.',
    inputs: ['Feature Inventory (DW-B3)', 'Role Inventory (DW-B1)', 'API Inventory (DW-B10)'],
    outputs: ['Documentation Requirement Set, tagged DOC-000n: user guides per role, admin documentation, API/integration documentation'],
    evidenceRequired: 'Each requirement cites the feature, role, or API it documents.',
    dependencies: ['Feature Inventory (DW-B3)', 'API Inventory (DW-B10)'],
    verification: V,
    failureConditions: [
      'A role with meaningfully complex responsibilities has no corresponding user guide requirement',
      'A public/partner-facing API has no API documentation requirement',
    ],
    reworkBehavior: 'Missing documentation for partner-facing APIs is Priority-1 given its role in Design-to-Code Traceability.',
    bossInteraction: 'Boss checks documentation coverage against role complexity and API audience (internal vs. partner-facing) rather than a flat per-feature requirement.',
    auditorInteraction: 'Red Team checks for missing admin/operator documentation, the most commonly deprioritized documentation class.',
    recursiveContribution: 'Not generative of new structural artifacts.',
    mpiContribution: 'DOC-000n entries are mandatory inputs to Blueprint Completeness Certification (§0.23).',
  },

  // --- Cluster E — Analysis & Adversarial Workers ---------------------------
  {
    id: 'DW-E1',
    name: 'Completeness Analysis Worker',
    cluster: 'E',
    responsibility: 'Run Recursive Self-Discovery (the department\u2019s own sweep ahead of Boss reconstruction) \u2014 repeatedly ask \u2018what is still missing?\u2019 across the full Master Product Inventory.',
    inputs: ['The full Master Product Inventory as certified through Pass 21'],
    outputs: ['Completeness Findings, each either a new Discovery Question or a routed artifact gap assigned back to its owning worker'],
    evidenceRequired: 'Each finding cites the specific completeness question that surfaced it (what have we forgotten; what would a senior PM/architect/UX/QA/DevOps/Security expect).',
    dependencies: ['Certified output of all Cluster A\u2013D workers through Pass 21'],
    verification: V,
    failureConditions: ['A completeness sweep produces zero findings on the first attempt \u2014 treated with suspicion and triggers a second sweep from a different question ordering before Pass 22 closes.'],
    reworkBehavior: 'Not itself reworked; it routes gaps to the owning worker and re-sweeps after correction.',
    bossInteraction: 'Feeds directly into the Boss\u2019s independent reconstruction (§0.15) as one input among several; the Boss re-derives its own expectation independently and treats agreement/disagreement as informative, not authoritative.',
    auditorInteraction: 'Operates ahead of the Red Team in the pass sequence (Pass 22 vs. Pass 17) but the Red Team\u2019s later findings are cross-checked against this sweep for consistency.',
    recursiveContribution: 'Is itself the mechanism of Pass 21\u2019s recursive loop: a sweep that produces new findings triggers another sweep.',
    mpiContribution: 'Creates no new artifact types; findings become new instances of existing types once routed and certified.',
  },
  {
    id: 'DW-E2',
    name: 'Contradiction Analysis Worker',
    cluster: 'E',
    responsibility: 'Run the Contradiction Engine (§0.19) \u2014 continuously scan the Master Product Inventory for direct and structural contradictions.',
    inputs: ['The full Master Product Inventory, continuously as it grows (not only at Pass 19)'],
    outputs: ['Contradiction Register, tagged CONTRADICTION-000n, each citing both conflicting artifacts by ID'],
    evidenceRequired: 'Each entry cites the exact two (or more) artifacts in conflict and the specific dimension of conflict (permission vs. rule, rule vs. rule, state vs. workflow).',
    dependencies: ['Runs against Business Rule Inventory (DW-C5), Permission Inventory (DW-C6), and Workflow Inventory (DW-B4) primarily, but scans all clusters.'],
    verification: V,
    failureConditions: ['A contradiction is silently resolved by picking one side without logging the conflict and its resolution rationale \u2014 itself treated as a verification failure of this worker.'],
    reworkBehavior: 'Never resolves a contradiction unilaterally; routes to the Discovery Boss (structural/product contradictions) or the Multi-Perspective Reasoning Council (judgment contradictions) and holds the entry open until a resolution with rationale is recorded.',
    bossInteraction: 'The Boss cannot certify Pass 19 (or issue Blueprint Completeness Certification, §0.23) while any Contradiction Register entry is open.',
    auditorInteraction: 'Red Team is a major source of raw material \u2014 many Red Team findings are, at root, contradictions between what one artifact implies and what another states.',
    recursiveContribution: 'A resolved contradiction that changes an artifact re-triggers that artifact\u2019s downstream dependency chain (via DW-C8) for re-verification.',
    mpiContribution: 'The Contradiction Register\u2019s open-entry count is a required-zero gate for Blueprint Completeness Certification (§0.23), not merely a report.',
  },
  {
    id: 'DW-E3',
    name: 'Negative-Space Discovery Worker',
    cluster: 'E',
    responsibility: 'Run Negative-Space Discovery (§0.11) \u2014 ask, recursively, what should exist because something else already exists.',
    inputs: ['The full Master Product Inventory, focused on Cluster B (Structural) artifacts as the seed set'],
    outputs: ['Negative-Space Findings, each resolved to Required/Not-Required/Uncertain exactly as the Industry Comparison Engine resolves its findings (§0.9)'],
    evidenceRequired: 'Each finding cites the seed artifact (e.g., a Payments feature) and the specific implied-ecosystem member it investigated (e.g., refunds).',
    dependencies: ['Feature Inventory (DW-B3) and Integration Inventory (DW-B11) as primary seed sets'],
    verification: V,
    failureConditions: ['A finding is added to the inventory without being evaluated against this product\u2019s actual scope (defaulting to \u2018add everything the ecosystem could contain\u2019).'],
    reworkBehavior: 'Un-scoped additions are returned and re-evaluated against the Product Understanding Brief (DW-A1) before being accepted.',
    bossInteraction: 'Boss checks that every \u2018Required\u2019 resolution traces to a real product need, not merely ecosystem completeness for its own sake.',
    auditorInteraction: 'Works in tandem with the Red Team: this worker reasons forward from what exists to what it implies; the Red Team reasons adversarially about what the inventory as a whole might still be missing.',
    recursiveContribution: 'Any \u2018Required\u2019 finding re-enters Page/Feature/Workflow Discovery and can itself become a new seed for further negative-space reasoning \u2014 the recursive property of §0.11.',
    mpiContribution: 'Findings become ordinary instances of existing artifact types once accepted; the worker itself creates no new artifact class.',
  },
  {
    id: 'DW-E4',
    name: 'Discovery Red Team',
    cluster: 'E',
    responsibility: 'Actively attack the certified inventory under the standing charter: assume it is incomplete, find what everyone else forgot (§0.10).',
    inputs: ['The full Master Product Inventory as certified through Pass 16 (after Industry Comparison)'],
    outputs: ['Red Team Findings, tagged REDTEAM-000n, resolved to Missing (added) / Not-Required (documented) / Uncertain (investigated)'],
    evidenceRequired: 'Each finding cites the specific category challenged (module, feature, page, workflow, permission, edge case, etc.) and the reasoning for why it is expected.',
    dependencies: ['Full inventory through Pass 16'],
    verification: V,
    failureConditions: ['Findings that merely propose additional functionality without evidence that it is genuinely missing \u2014 internal scoring rewards genuine omissions, never volume.'],
    reworkBehavior: 'Findings resolved \u2018Not-Required\u2019 still require a documented reason; an unresolved \u2018Uncertain\u2019 finding cannot close without a Discovery Question or a Boss ruling.',
    bossInteraction: 'The Boss treats every \u2018Missing\u2019 finding as a required delta in its own reconstruction; a Red Team finding the Boss did not also surface is investigated as a possible gap in the Boss\u2019s own model.',
    auditorInteraction: 'N/A (this is the Red Team itself).',
    recursiveContribution: 'Every accepted \u2018Missing\u2019 finding re-enters the relevant Discovery pass exactly as any other new artifact would.',
    mpiContribution: 'Red Team findings are the only artifact class explicitly scored for genuine-omission rate as an ongoing quality metric on the Worker Corps as a whole.',
  },
  {
    id: 'DW-E5',
    name: 'Discovery Auditor',
    cluster: 'E',
    responsibility: 'Perform the final, independent re-check after the Discovery Boss has certified the inventory (Pass 24) \u2014 the last gate before Blueprint Completeness Certification is eligible to be evaluated by Stage 1.',
    inputs: ['The Discovery Boss\u2019s certified Master Product Inventory and its reconstruction-diff record (§0.15)'],
    outputs: ['Audit Certificate: either a clean certification or a rejection with the specific artifacts and dimensions (of the eleven in §0.16) that failed'],
    evidenceRequired: 'The Auditor independently samples a statistically meaningful subset of artifacts across every cluster and re-runs the evidence check (§0.18) on each, rather than reviewing the Boss\u2019s summary.',
    dependencies: ['Discovery Boss\u2019s Pass 23 output'],
    verification: V,
    failureConditions: ['A sampled artifact fails evidence inspection despite carrying a CERTIFIED status \u2014 a Priority-1 failure of the certification process itself that triggers a wider re-sample.'],
    reworkBehavior: 'On any sampled failure the Auditor widens its sample and, if the failure rate exceeds tolerance, rejects the entire certification and returns it to the Boss rather than approving with exceptions.',
    bossInteraction: 'The Auditor is structurally independent of the Boss \u2014 the same separation of production and judgment described in §0.4 applies a second time, since the Boss\u2019s own judgment is itself audited.',
    auditorInteraction: 'Distinct from the Red Team: the Red Team attacks completeness before certification; the Auditor verifies the certification process itself was sound after the fact.',
    recursiveContribution: 'An Auditor rejection re-enters the department at Pass 23 (Boss reconstruction), not Pass 1 \u2014 the finding is about the certification, not necessarily about re-running all of Discovery.',
    mpiContribution: 'Only after a clean Audit Certificate does the Master Product Inventory become eligible to be read as the frozen baseline for Stage 1 Design\u2019s own independent reconstruction.',
  },
];

export const WORKER_ROLE_IDS: readonly string[] = DISCOVERY_WORKER_ROLES.map((r) => r.id);

const BY_ID: ReadonlyMap<string, DiscoveryWorkerRole> = new Map(
  DISCOVERY_WORKER_ROLES.map((r) => [r.id, r]),
);

export function getDiscoveryWorkerRole(id: string): DiscoveryWorkerRole | undefined {
  return BY_ID.get(id);
}

export function requireDiscoveryWorkerRole(id: string): DiscoveryWorkerRole {
  const role = BY_ID.get(id);
  if (role === undefined) {
    throw new Error(
      `Unknown Discovery Worker role "${id}". Known roles: ${WORKER_ROLE_IDS.join(', ')}.`,
    );
  }
  return role;
}
