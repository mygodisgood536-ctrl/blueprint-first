/* Blueprint-First inspection frontend. Reads the live REST API only. */

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${url} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

function el(id, html) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = html;
}

function kvRow(key, value, opts) {
  const cls = opts && opts.full ? ' val full' : '';
  const safeKey = key.replace(/</g, '&lt;');
  const safeVal = value === null || value === undefined ? '—' : String(value).replace(/</g, '&lt;');
  return `<div class="row"><div class="key">${safeKey}</div><div class="val${cls}">${safeVal}</div></div>`;
}

function kv(data, id) {
  if (!data) { el(id, '<div class="muted small">no data</div>'); return; }
  const rows = Object.entries(data).map(([k, v]) =>
    kvRow(k, typeof v === 'object' ? JSON.stringify(v) : v),
  );
  el(id, rows.join(''));
}

function stateTag(state) {
  const cls =
    String(state).includes('CERTIFIED') ? 'good' :
    String(state).includes('AUTHORIZED') ? 'warn' :
    String(state).toUpperCase().includes('REJECTED') || String(state).toUpperCase().includes('FAIL') ? 'bad' :
    'muted';
  return `<span class="tag ${cls}">${state}</span>`;
}

function overviewRows(s) {
  return [
    ['productName / projectId', s.projectName],
    ['envName', s.envName],
    ['dataDir', s.dataDir],
    ['provider', s.provider],
    ['providerCalls', s.providerCalls],
    ['storeKind', s.storeKind],
    ['evidenceCount', s.evidenceCount],
    ['discoveryArtifacts', s.discoveryArtifacts],
    ['blueprintId', s.blueprintId],
    ['manifestId', s.manifestId],
    ['graph (nodes/edges)', `${s.graph.nodeCount} / ${s.graph.edgeCount}`],
    ['councilVerdict', s.councilVerdict],
    ['masterPassed', s.masterPassed],
    ['traceComplete', s.traceComplete],
  ].map(([k, v]) => kvRow(k, v)).join('');
}

async function loadCertificationBanner(s) {
  let html;
  if (s.certified) {
    html = `<span class="state-certified">CERTIFIED</span>
      <span class="muted small"> — ${s.certifiedStamped} artifact(s) stamped · evidence ${s.certificationEvidenceId}</span>`;
  } else {
    html = `<span class="state-other">NOT CERTIFIED</span>`;
  }
  el('cert-state', html);
  el('header-sub',
    `project ${s.projectId} · blueprint ${s.blueprintId ?? 'n/a'} · URL reflects the live L0–L5 pipeline run`);
}

function artifactDocBadges(artifacts) {
  const counts = { CERTIFIED: 0, AUTHORIZED: 0, PROPOSED: 0, OTHER: 0 };
  for (const a of artifacts) {
    const d = (a.docState || '').toUpperCase();
    if (d.includes('CERTIFIED') || a.status === 'VERIFIED') counts.CERTIFIED++;
    else if (d.includes('RE-MEDIATED')) counts.AUTHORIZED++;
    else counts.OTHER++;
  }
  return [
    kvRow('total artifacts', artifacts.length),
    kvRow('<span class="state-certified">✓ CERTIFIED / VERIFIED</span>', counts.CERTIFIED),
    kvRow('<span class="state-authorized">AUTHORIZED / RE-MEDIATED</span>', counts.AUTHORIZED),
    kvRow('<span class="state-other">other / proposed states</span>', counts.OTHER),
  ].join('');
}

async function renderArtifacts() {
  const data = await getJSON('/api/artifacts');
  el('artifacts-summary', artifactDocBadges(data.artifacts));
  const body = data.artifacts.map((a) => `
    <tr>
      <td>${a.id}</td>
      <td>${a.type}</td>
      <td>${a.title}</td>
      <td>${stateTag(a.status)}</td>
      <td>${a.docState ? stateTag(a.docState) : '—'}</td>
      <td>${a.confidence === null ? '—' : a.confidence}</td>
    </tr>`).join('');
  document.querySelector('#artifacts tbody').innerHTML = body;
}

async function renderPeoOrgans(peo) {
  const watch = peo.watch;
  const impact = peo.impact;
  const change = peo.change;
  const candidate = peo.candidate;
  const rows = [
    kvRow('13. Guardian classification', stateTag(watch.classifiedAs)),
    kvRow('   rootCause', watch.rootCause),
    kvRow('   watchEvidence', (watch.evidenceHash || '').slice(0, 20)),
    kvRow('14. Impact Analysis affected', impact.affected.length),
    kvRow('   declared', impact.declared.join(', ')),
    kvRow('   discovered (surprise set)', impact.discovered.join(', ')),
    kvRow('   analysisHash', (impact.analysisHash || '').slice(0, 20)),
    kvRow('15. Self-Healing candidate', candidate ? candidate.changeId : 'none'),
    kvRow('   candidate summary', candidate ? candidate.summary : '—'),
    kvRow('16. Evolution Review', 'available in core; not exercised in this run'),
    kvRow('17. Learning', 'available in core; not exercised in this run'),
    kvRow('18. Change History', 'available in core; not exercised in this run'),
    kvRow('19. Living Blueprint', 'available in core; not exercised in this run (see caps note)'),
  ];
  el('peo-organs', rows.join(''));
}

async function render() {
  try {
    const s = await getJSON('/api/summary');
    const [roadmap, discovery, design, certification, council, verification, testing,
      deployment, telemetry, continuous, recursion, safeChange, peo, artifacts,
      depMap, lineage, evidence, traceability, caps] = await Promise.all([
      getJSON('/api/roadmap'),
      getJSON('/api/discovery'),
      getJSON('/api/design'),
      getJSON('/api/certification'),
      getJSON('/api/council'),
      getJSON('/api/verification'),
      getJSON('/api/testing'),
      getJSON('/api/deployment'),
      getJSON('/api/telemetry'),
      getJSON('/api/continuous'),
      getJSON('/api/recursion'),
      getJSON('/api/safe-change'),
      getJSON('/api/peo'),
      getJSON('/api/artifacts'),
      getJSON('/api/dependency-map'),
      getJSON('/api/lineage'),
      getJSON('/api/evidence'),
      getJSON('/api/traceability'),
      getJSON('/api/caps'),
    ]);

    await loadCertificationBanner(s);

    // Roadmap
    const roadmapRows = roadmap.roadmap.map((r) =>
      `<tr><td>${r.level}</td><td>${r.title}</td><td>${stateTag(r.status)}</td></tr>`).join('');
    document.querySelector('#roadmap tbody').innerHTML = roadmapRows;

    // Overview
    el('overview', overviewRows(s));

    // Discovery
    el('discovery',
      kvRow('status', stateTag(discovery.status)) +
      kvRow('projectId', discovery.baseline.projectId) +
      kvRow('total artifacts', discovery.baseline.totalArtifacts) +
      kvRow('artifact count (ids)', discovery.artifactIds.length) +
      kvRow('findingIds', (discovery.findingIds || []).join(', ') || 'none') +
      kvRow('reconstruction deltas', discovery.diff ? discovery.diff.deltas.length : 0));

    // Design
    el('design',
      kvRow('status', stateTag(design.status)) +
      kvRow('blueprintId', design.blueprintId) +
      kvRow('design artifact count', design.artifactIds.length) +
      kvRow('design ids', design.artifactIds.join(', ')) +
      kvRow('approval', design.approval.approved ? stateTag('APPROVED') : stateTag('NOT APPROVED')) +
      kvRow('approval evidence', design.approval.evidenceId || '—'));

    // Certification
    el('certification',
      kvRow('certified', stateTag(certification.certified ? 'CERTIFIED' : 'NOT CERTIFIED')) +
      kvRow('stamped artifact ids', certification.stampedArtifactIds.join(', ') || 'none') +
      kvRow('evidence', certification.evidenceId || '—') +
      kvRow('trace complete', certification.trace.complete) +
      kvRow('confidence aggregate', certification.confidence ? certification.confidence.aggregateScore : 'n/a') +
      kvRow('unproduced dimensions exclusions', certification.confidence && certification.confidence.dimensions
        ? certification.confidence.dimensions.filter((d) => d.score === null).map((d) => d.id).join(', ')
        : 'none'));

    // Council
    el('council',
      kvRow('subject', council.subject) +
      kvRow('verdict', council.verdict) +
      kvRow('seat count', (council.seats || []).length) +
      (council.seats || []).map((seat) =>
        kvRow(`seat ${seat.seatId}`, `${seat.title}: ${seat.stance}`)).join(''));

    // Verification
    el('verification',
      kvRow('masterPassed', verification.masterPassed) +
      kvRow('subjects audited', verification.subjectsAudited) +
      kvRow('blocking fails', verification.blockingFails) +
      kvRow('unresolved inconclusive', verification.unresolvedInconclusive.join(', ') || 'none') +
      kvRow('closure artifact count', verification.closureArtifactCount) +
      kvRow('notes', verification.notes));

    // Testing
    el('testing',
      kvRow('status', stateTag(testing.status)) +
      kvRow('checks executed', testing.executed.length) +
      kvRow('TEST artifact ids', testing.testIds.join(', ')) +
      kvRow('report', testing.reportId || '—') +
      kvRow('evidence', testing.evidenceId || '—') +
      kvRow('advanced to TEST-VERIFIED', testing.advancedToTestVerified.length) +
      kvRow('boss verdict', testing.boss.verdict) +
      kvRow('auditor verdict', testing.auditor.verdict));

    // Deployment
    el('deployment',
      kvRow('status', stateTag(deployment.status)) +
      kvRow('units deployed', deployment.executed.length) +
      kvRow('DEPLOY artifact ids', deployment.deployIds.join(', ')) +
      kvRow('manifest', deployment.manifestId || '—') +
      kvRow('advanced to DEPLOYED-VERIFIED', deployment.advancedToDeployedVerified.length) +
      kvRow('boss verdict', deployment.boss.verdict) +
      kvRow('auditor verdict', deployment.auditor.verdict));

    // Telemetry
    el('telemetry',
      kvRow('observation id', telemetry.observation.id) +
      kvRow('baseId', telemetry.observation.baseId) +
      kvRow('metric', telemetry.observation.metric) +
      kvRow('value', JSON.stringify(telemetry.observation.value)) +
      kvRow('breach', telemetry.observation.breach) +
      kvRow('source kind', telemetry.sourceKind) +
      kvRow('evidenceHash', (telemetry.observation.evidenceHash || '').slice(0, 20)));

    // Continuous
    el('continuous',
      kvRow('finalVerdict', stateTag(continuous.finalVerdict)) +
      kvRow('rationale', continuous.rationale) +
      kvRow('artifacts observed', continuous.workerReport.scopedCount) +
      kvRow('stable', continuous.workerReport.stableCount) +
      kvRow('boss verdict', continuous.bossDecision.verdict) +
      kvRow('auditor verdict', continuous.auditorDecision.verdict) +
      kvRow('materialization manifest', continuous.materialization ? continuous.materialization.manifestId : '—') +
      kvRow('OPS lineage', continuous.materialization ? continuous.materialization.opsIds.join(', ') : 'none'));

    // Recursion
    el('recursion',
      kvRow('allRemediated', recursion.allRemediated) +
      kvRow('regressions', recursion.classification.regressions.length) +
      kvRow('actionable', recursion.classification.actionable.length) +
      kvRow('change count', recursion.changeCount) +
      kvRow('base ids', recursion.baseIds.join(', ')));

    // Safe Change
    el('safe-change',
      kvRow('status', stateTag(safeChange.status)) +
      kvRow('reason', safeChange.reason || '—') +
      kvRow('boss verdict', safeChange.trail.bossDecision.verdict) +
      kvRow('auditor verdict', safeChange.trail.auditorDecision.verdict) +
      kvRow('proposal id', safeChange.materialization ? safeChange.materialization.proposalId : '—') +
      kvRow('approval id', safeChange.materialization ? safeChange.materialization.approvalId : '—') +
      kvRow('change id', safeChange.materialization && safeChange.materialization.changeId ? safeChange.materialization.changeId : '—') +
      kvRow('final DoC state', stateTag(safeChange.finalDocState)));

    // PEO
    el('peo',
      kvRow('source', peo.source) +
      kvRow('authorized', peo.authorized) +
      kvRow('escalated', peo.escalated) +
      kvRow('rationale', peo.rationale) +
      kvRow('guardian classification', stateTag(peo.watch.classifiedAs)) +
      kvRow('safe-change status', stateTag(peo.change.status)));

    // PEO sub-organs
    await renderPeoOrgans(peo);

    // Artifacts
    el('artifacts-summary', artifactDocBadges(artifacts.artifacts));
    renderArtifactsTable(artifacts.artifacts);

    // Dependency map
    el('dep-map',
      kvRow('nodes', depMap.nodeCount) +
      kvRow('edges', depMap.edgeCount) +
      kvRow('DEPENDS_ON edges', depMap.edges.filter((e) => e.relation === 'DEPENDS_ON').length) +
      kvRow('CONTAINS edges', depMap.edges.filter((e) => e.relation === 'CONTAINS').length) +
      kvRow('DERIVED_FROM edges', depMap.edges.filter((e) => e.relation === 'DERIVED_FROM').length));

    // Lineage
    el('lineage',
      kvRow('first page', lineage.firstPageId) +
      kvRow('complete through', lineage.completeThrough) +
      kvRow('gaps', lineage.gaps.map((g) => g.id).join(', ') || 'none') +
      kvRow('links', lineage.links.map((l) => `${l.id} (${l.exists ? l.status : 'missing'})`).join(' · ')));

    // Evidence
    el('evidence',
      kvRow('evidence records', evidence.count) +
      kvRow('entries', evidence.entries
        ? evidence.entries.map((e) => `${e.id}:${e.kind}`).join(', ')
        : 'n/a'));

    // Traceability
    el('traceability',
      kvRow('complete', traceability.complete) +
      (traceability.rows === undefined ? '' :
        Object.entries(traceability.rows).map(([k, v]) => kvRow(k, JSON.stringify(v))).join('')));

    // Caps
    el('caps', caps.availableNotExercised.map((c) =>
      kvRow(c.id, `${c.label} — ${c.note}`)).join(''));
  } catch (err) {
    document.body.insertAdjacentHTML('afterbegin',
      `<div class="card" style="border-color:var(--bad)"><b>Load error:</b> ${err.message}</div>`);
  }
}

function renderArtifactsTable(artifacts) {
  const body = artifacts.map((a) => `
    <tr>
      <td>${a.id}</td>
      <td>${a.type}</td>
      <td>${a.title}</td>
      <td>${stateTag(a.status)}</td>
      <td>${a.docState ? stateTag(a.docState) : '—'}</td>
      <td>${a.confidence === null ? '—' : a.confidence}</td>
    </tr>`).join('');
  const tbody = document.querySelector('#artifacts tbody');
  if (tbody) tbody.innerHTML = body;
}

render();
