import { stagesForMode } from './data'
export * from './instances2'

export const mockProjects = [
  { id: 'prj_lumina_8k2m', name: 'Lumina Dashboard', mode: 'full-product' as const, status: 'active' as const, owner: 'cornelius', description: 'An analytics dashboard for engineering teams to visualize lifecycle progress and evidence quality.', lastActivity: '2026-09-10T08:32:00Z', visionDocId: 'doc_vision_001', stages: stagesForMode('full-product', 5) },
  { id: 'prj_aurora_3f7x', name: 'Aurora API', mode: 'design-plus-code' as const, status: 'active' as const, owner: 'cornelius', description: 'A RESTful API service for document ingestion and classification.', lastActivity: '2026-09-09T14:15:00Z', stages: stagesForMode('design-plus-code', 3) },
  { id: 'prj_helix_9q4t', name: 'Helix Design System', mode: 'design-only' as const, status: 'active' as const, owner: 'cornelius', description: 'A design-only exploration of a reusable component library.', lastActivity: '2026-09-08T11:00:00Z', stages: stagesForMode('design-only', 1) },
  { id: 'prj_nimbus_6w1p', name: 'Nimbus Mobile', mode: 'full-product' as const, status: 'paused' as const, owner: 'cornelius', description: 'Mobile companion for the NEXORA engineering workspace.', lastActivity: '2026-08-21T09:45:00Z', stages: stagesForMode('full-product', 2) },
]

export const mockDocuments = [
  { id: 'doc_vision_001', title: 'Lumina — Vision & Intent', projectId: 'prj_lumina_8k2m', type: 'vision' as const, size: 4820, createdAt: '2026-09-01T10:00:00Z', classification: 'document' as const,
    contentHash: 'sha256:9f2c1a7e4b8d3f6a1c5e9d2b7a4f8c3e6d9b2a5f8c1e4d7a9b3c6f2e5d8a1c4f',
    content: 'Lumina — Vision & Intent\n\n1. Purpose\nLumina is an analytics dashboard for engineering teams. It visualises lifecycle progress and evidence quality so a team can see, at a glance, whether work is understood, built, and verified.\n\n2. Users\nEngineering leads who need a truthful picture of delivery state. Individual engineers who want to see what their stage produced and what evidence supports it.\n\n3. Core experiences\n3.1 Project overview with a live lifecycle strip.\n3.2 Engineering record: artifacts, evidence, lineage, certification.\n3.3 Attention list: what is blocked, what needs approval, what failed.\n\n4. Constraints\nEvery surface must distinguish generated from verified work. No fake progress. Every claim links to evidence.\n\n5. Success measures\n- A new user can create a project and run Discovery unaided.\n- Verification failures are understood without leaving the product.\n- The blueprint is the single source of truth for what is built.' },
  { id: 'doc_spec_002', title: 'Aurora API Specification', projectId: 'prj_aurora_3f7x', type: 'spec' as const, size: 12400, createdAt: '2026-09-03T09:00:00Z', classification: 'document' as const,
    contentHash: 'sha256:1b7e3f9a2c8d4e6f0a9b3c5e7d1f8a2b4c6e9d0f3a5b7c9e1d3f5a7b9c0e2d4f',
    content: 'Aurora API Specification\n\n1. Overview\nAurora is a RESTful document-ingestion service. Clients submit text; Aurora classifies it (inline message vs. stored document) and returns a reference.\n\n2. Endpoints\n2.1 POST /ingest — accepts { text }. Classification threshold: 8,000 characters. At or below the threshold the content is treated as an inline message; above it the content is stored as a document and a reference id is returned.\n2.2 GET /documents/:id — returns document metadata and bounded preview.\n2.3 GET /documents/:id/content — returns full stored content.\n\n3. Errors\n400 on empty text. 413 above the hard storage cap. 429 when rate-limited.\n\n4. Non-functional\n- P95 ingest latency under 300ms for inline classification.\n- Content is stored with a sha256 content hash for traceability.' },
  { id: 'doc_note_003', title: 'Engineering Council Notes', type: 'note' as const, size: 1200, createdAt: '2026-09-05T16:30:00Z', classification: 'inline' as const,
    contentHash: 'sha256:4e2a9c7b1d8f3a6e0c4b7d9a2f5e8c1b4d7a0f3c6e9b2d5a8c1f4e7b0d3a6c9f',
    content: 'Engineering Council Notes — 2026-09-05\n\nAttending: Cornelius, the design studio, the verification engine.\n\nDecisions:\n1. The approval gate stays hard: nothing is built until the blueprint is approved.\n2. Out-of-scope stages are shown as out of scope, never as "coming soon".\n3. Re-verification reruns all eleven dimensions; inconclusive results fail honestly until evidence exists.\n\nActions:\n- The design studio to propose the 32-coverage display.\n- Operations to wire the telemetry stream.' },
  { id: 'doc_ingest_004', title: 'User Research Transcript', projectId: 'prj_lumina_8k2m', type: 'ingest' as const, size: 8600, createdAt: '2026-09-07T12:00:00Z', classification: 'document' as const,
    contentHash: 'sha256:7c1f4a8e2b9d3c6f0a5e8b1d4c7f2a9e5b8c1d4f7a0e3b6c9d2f5a8e1b4c7f0d',
    content: 'User Research Transcript — Session 4\n\nParticipant: P4, engineering lead, 12-person platform team.\n\nP4: "The lifecycle strip is the first thing I check. If Discovery is recorded and Blueprint is pending, I know exactly where the work is."\n\nP4: "Evidence matters more than confidence numbers. Show me the decision and what supports it, and I can defend it to my team."\n\nP4: "I do not want the product to tell me everything is fine. If a test failed, say what failed, what it affects, and what to do next."\n\nInterviewer notes: P4 twice returned to the workspace hub and used the attention list before opening any project. P4 did not use the model catalogue during the session — provider state was already configured.' },
]

export const mockActivity = [
  { id: 'act_001', type: 'stage_run' as const, title: 'Discovery completed for Lumina Dashboard', timestamp: '2026-09-10T08:32:00Z', projectId: 'prj_lumina_8k2m' },
  { id: 'act_002', type: 'approval' as const, title: 'Design approved for Helix Design System', timestamp: '2026-09-09T17:00:00Z', projectId: 'prj_helix_9q4t' },
  { id: 'act_003', type: 'document' as const, title: 'User Research Transcript ingested', timestamp: '2026-09-07T12:00:00Z', projectId: 'prj_lumina_8k2m' },
  { id: 'act_004', type: 'project' as const, title: 'Nimbus Mobile created', timestamp: '2026-08-21T09:45:00Z', projectId: 'prj_nimbus_6w1p' },
  { id: 'act_005', type: 'auth' as const, title: 'New session from Chrome on Windows', timestamp: '2026-09-10T08:00:00Z' },
  { id: 'act_006', type: 'stage_run' as const, title: 'Blueprint recorded for Aurora API', timestamp: '2026-09-09T14:15:00Z', projectId: 'prj_aurora_3f7x' },
]

export const mockProviders = [
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o, o1 models', authMethod: 'api_key' as const, website: 'https://openai.com', models: [
    { id: 'gpt-4o', providerId: 'openai', name: 'GPT-4o', accessCategory: 'paid', contextLength: 128000, maxOutput: 16384, costIn: 2.5, costOut: 10, capabilities: ['streaming', 'tool-calling', 'vision', 'structured-output'], status: 'connected' },
    { id: 'o1-preview', providerId: 'openai', name: 'o1 Preview', accessCategory: 'paid', contextLength: 128000, maxOutput: 32768, costIn: 15, costOut: 60, capabilities: ['reasoning', 'structured-output'], status: 'auth_required' },
  ]},
  { id: 'anthropic', name: 'Anthropic', description: 'Claude 4 family', authMethod: 'api_key' as const, website: 'https://anthropic.com', models: [
    { id: 'claude-4-sonnet', providerId: 'anthropic', name: 'Claude 4 Sonnet', accessCategory: 'paid', contextLength: 200000, maxOutput: 64000, costIn: 3, costOut: 15, capabilities: ['streaming', 'tool-calling', 'vision', 'reasoning', 'structured-output'], status: 'connected' },
  ]},
  { id: 'google', name: 'Google', description: 'Gemini models', authMethod: 'api_key' as const, website: 'https://google.com', models: [
    { id: 'gemini-2.5-pro', providerId: 'google', name: 'Gemini 2.5 Pro', accessCategory: 'paid', contextLength: 1000000, maxOutput: 65536, costIn: 1.25, costOut: 10, capabilities: ['streaming', 'tool-calling', 'vision', 'reasoning'], status: 'auth_required' },
  ]},
  { id: 'ollama', name: 'Ollama', description: 'Local models on your hardware', authMethod: 'none' as const, website: 'https://ollama.com', models: [
    { id: 'llama-3.1-8b', providerId: 'ollama', name: 'Llama 3.1 8B', accessCategory: 'local', contextLength: 128000, maxOutput: 8192, costIn: 0, costOut: 0, capabilities: ['streaming', 'tool-calling'], status: 'connected' },
  ]},
]

export const mockCredentials = [
  { id: 'cred_001', providerId: 'openai', label: 'Personal OpenAI key', addedAt: '2026-08-15T10:00:00Z', verified: true, verifyTimestamp: '2026-08-15T10:02:00Z' },
  { id: 'cred_002', providerId: 'anthropic', label: 'Work Anthropic key', addedAt: '2026-09-01T09:00:00Z', verified: true, verifyTimestamp: '2026-09-01T09:01:00Z' },
]
