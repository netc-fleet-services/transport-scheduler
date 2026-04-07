/* ═══════════════════════════════════════════════
   NETC Transport Planner — Database Operations

   All reads and writes to Supabase go through
   this file. The app never calls sb.from(...)
   directly — always use these functions instead.

   Column mapping: DB uses snake_case, app uses camelCase.
   toDB() and toApp() handle the translation.
   ═══════════════════════════════════════════════ */

// ── Column mappers ──────────────────────────────

function jobToDB(j) {
  return {
    id:           String(j.id),
    yard_id:      j.yardId       || null,
    driver_id:    j.driverId     || null,
    pickup_zip:   j.pickupZip    || null,
    drop_zip:     j.dropZip      || null,
    pickup_addr:  j.pickupAddr   || null,
    drop_addr:    j.dropAddr     || null,
    tb_call_num:  j.tbCallNum    || null,
    tb_desc:      j.tbDesc       || null,
    tb_scheduled: j.tbScheduled  || null,
    tb_reason:    j.tbReason     || null,
    tb_driver:    j.tbDriver     || null,
    priority:     j.priority     || 'normal',
    status:       j.status       || 'scheduled',
    day:          j.day,
    notes:        j.notes        || null,
    stops:        j.stops        || [],
    started_at:   j.startedAt    || null,
    completed_at: j.completedAt  || null,
    added_at:     j.addedAt      || new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  };
}

function jobToApp(row) {
  return {
    id:           row.id,
    yardId:       row.yard_id,
    driverId:     row.driver_id,
    pickupZip:    row.pickup_zip,
    dropZip:      row.drop_zip,
    pickupAddr:   row.pickup_addr   || '',
    dropAddr:     row.drop_addr     || '',
    tbCallNum:    row.tb_call_num,
    tbDesc:       row.tb_desc,
    tbScheduled:  row.tb_scheduled,
    tbReason:     row.tb_reason     || '',
    tbDriver:     row.tb_driver     || '',
    priority:     row.priority,
    status:       row.status,
    day:          row.day,
    notes:        row.notes         || '',
    stops:        row.stops         || [],
    startedAt:    row.started_at,
    completedAt:  row.completed_at,
    addedAt:      row.added_at,
  };
}

function driverToDB(d) {
  return { id: d.id, name: d.name, truck: d.truck || null, yard: d.yard };
}

function driverToApp(row) {
  return { id: row.id, name: row.name, truck: row.truck || '', yard: row.yard };
}

// ── Jobs ────────────────────────────────────────

var db = {

  async loadAllJobs() {
    var { data, error } = await sb.from('jobs').select('*').order('added_at');
    if (error) { console.error('db.loadAllJobs:', error); return []; }
    return (data || []).map(jobToApp);
  },

  async upsertJob(job) {
    var { error } = await sb.from('jobs')
      .upsert(jobToDB(job), { onConflict: 'id' });
    if (error) console.error('db.upsertJob:', error);
  },

  async batchUpsertJobs(jobs) {
    if (!jobs.length) return;
    var { error } = await sb.from('jobs')
      .upsert(jobs.map(jobToDB), { onConflict: 'id' });
    if (error) console.error('db.batchUpsertJobs:', error);
  },

  // Mark a list of job IDs as cancelled (used during TowBook import)
  async cancelJobs(ids) {
    if (!ids.length) return;
    var { error } = await sb.from('jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .in('id', ids.map(String));
    if (error) console.error('db.cancelJobs:', error);
  },

  async deleteJob(id) {
    var { error } = await sb.from('jobs').delete().eq('id', String(id));
    if (error) console.error('db.deleteJob:', error);
  },

  // Clear all jobs — used by the Reset button. Destructive!
  async clearAllJobs() {
    var { error } = await sb.from('jobs').delete().not('id', 'is', null);
    if (error) console.error('db.clearAllJobs:', error);
  },

  // ── Drivers ──────────────────────────────────

  async loadDrivers() {
    var { data, error } = await sb.from('drivers').select('*').order('id');
    if (error) { console.error('db.loadDrivers:', error); return []; }
    return (data || []).map(driverToApp);
  },

  async upsertDriver(driver) {
    var { error } = await sb.from('drivers')
      .upsert(driverToDB(driver), { onConflict: 'id' });
    if (error) console.error('db.upsertDriver:', error);
  },

  async deleteDriver(id) {
    var { error } = await sb.from('drivers').delete().eq('id', id);
    if (error) console.error('db.deleteDriver:', error);
  },

  // ── Yards ────────────────────────────────────

  async loadYards() {
    var { data, error } = await sb.from('yards').select('*').order('short');
    if (error) { console.error('db.loadYards:', error); return []; }
    return data || [];
  },

  async upsertYard(yard) {
    var { error } = await sb.from('yards')
      .upsert(yard, { onConflict: 'id' });
    if (error) console.error('db.upsertYard:', error);
  },

  async deleteYard(id) {
    var { error } = await sb.from('yards').delete().eq('id', id);
    if (error) console.error('db.deleteYard:', error);
  },

  // ── Settings ─────────────────────────────────
  // Stored as key/value pairs — value is any JSON-serializable type.

  async loadSetting(key, defaultValue) {
    var { data, error } = await sb.from('settings')
      .select('value').eq('key', key).maybeSingle();
    if (error) { console.error('db.loadSetting:', error); return defaultValue; }
    return data ? data.value : defaultValue;
  },

  async saveSetting(key, value) {
    var { error } = await sb.from('settings')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) console.error('db.saveSetting:', error);
  },

};
