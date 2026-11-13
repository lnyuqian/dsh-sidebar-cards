/**
 * dsh-sidebar-cards · Host 半边
 *
 * 提供两块能力：
 *   GET  /api/sidebar-cards/version  轻量版本号（客户端高频轮询，不变就不拉全量）
 *   GET  /api/sidebar-cards/data     聚合快照（工作区 / 会话 / 置顶 / 归档 / 自动化任务）
 *   POST /api/sidebar-cards/act      动作（置顶 / 归档 / 取消）
 *   POST /api/sidebar-cards/report   客户端诊断回写（无浏览器可读，用于验证）
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const name = 'dsh-sidebar-cards'
export const inject = ['webServer']

// 排障用：默认不落盘；设置 DSH_SIDEBAR_CARDS_DEBUG_DIR 才写诊断记录
const REPORT_DIR = process.env.DSH_SIDEBAR_CARDS_DEBUG_DIR || path.join(os.tmpdir(), 'dsh-sidebar-cards-debug')
const CREATED_AT_TTL_MS = 10 * 60 * 1000

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function appendReport(file, data) {
  if (!process.env.DSH_SIDEBAR_CARDS_DEBUG_DIR) return false
  try {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
    fs.appendFileSync(path.join(REPORT_DIR, `${file}.jsonl`), JSON.stringify({ at: new Date().toISOString(), data }) + '\n', 'utf8')
    return true
  } catch (error) {
    return String((error && error.message) || error)
  }
}

export function apply(ctx) {
  const tried = []
  let createdAtCache = { at: 0, map: {} }
  let createdAtLoading = null

  function get(name) {
    try {
      return ctx.get(name)
    } catch {
      return undefined
    }
  }

  async function ensureCreatedAt() {
    const fresh = Date.now() - createdAtCache.at < CREATED_AT_TTL_MS
    if (fresh) return createdAtCache.map
    if (!createdAtLoading) {
      const sq = get('sessionQuery')
      createdAtLoading = Promise.resolve()
        .then(() => (sq ? sq.listSessions() : []))
        .then((list) => {
          const map = {}
          for (const record of list || []) {
            const header = record && record.header
            if (header && header.id) map[header.id] = header.createdAt
          }
          createdAtCache = { at: Date.now(), map }
          return map
        })
        .catch((error) => {
          appendReport('host-error', { where: 'createdAt', message: String((error && error.message) || error) })
          createdAtCache = { at: Date.now(), map: {} }
          return {}
        })
        .finally(() => {
          createdAtLoading = null
        })
    }
    return createdAtLoading
  }

  function workspaceTitle(workspace) {
    const raw = workspace && workspace.title
    return typeof raw === 'function' ? raw() : raw || ''
  }

  async function buildData() {
    const registry = get('workspaceRegistry')
    const controller = get('sessionController')
    const schedule = get('schedule')

    const workspaces = []
    const memberIds = new Set()
    try {
      for (const workspace of registry ? registry.list() : []) {
        const sessionIds = workspace.sessionIds ? [...workspace.sessionIds] : []
        for (const id of sessionIds) memberIds.add(id)
        workspaces.push({
          id: workspace.id,
          title: workspaceTitle(workspace),
          path: workspace.path || '',
          sessionIds,
        })
      }
    } catch (error) {
      appendReport('host-error', { where: 'workspaces', message: String((error && error.message) || error) })
    }

    const readList = (value) => {
      const resolved = typeof value === 'function' ? value() : value
      return Array.isArray(resolved) ? resolved.slice() : []
    }
    const pinned = registry ? readList(registry.pinnedSessionIds) : []
    const archived = registry ? readList(registry.archivedSessionIds) : []
    const archivedSet = new Set(archived)
    const pinnedSet = new Set(pinned)

    let items = []
    try {
      const listed = controller ? await controller.list() : { items: [] }
      items = (listed && listed.items) || []
    } catch (error) {
      appendReport('host-error', { where: 'controller.list', message: String((error && error.message) || error) })
    }

    const createdAtMap = await ensureCreatedAt()
    const sessions = {}
    let latestUpdated = 0
    for (const item of items) {
      const id = item.sessionId
      if (!id) continue
      const values = (item.projections && item.projections.values) || {}
      const title = values.title || ''
      const updatedAt = item.updatedAt || 0
      if (updatedAt > latestUpdated) latestUpdated = updatedAt
      sessions[id] = {
        id,
        title: typeof title === 'string' ? title : '',
        createdAt: createdAtMap[id] || updatedAt,
        updatedAt,
        running: !!item.running,
        blank: !!item.blank,
        archived: archivedSet.has(id),
        pinned: pinnedSet.has(id),
        cwd: item.cwd || '',
        ungrouped: !memberIds.has(id),
      }
    }
    // 置顶/归档里没有摘要的会话也补一条，避免列表丢行
    for (const id of [...pinned, ...archived]) {
      if (!sessions[id]) {
        sessions[id] = {
          id,
          title: '',
          createdAt: createdAtMap[id] || 0,
          updatedAt: 0,
          running: false,
          blank: false,
          archived: archivedSet.has(id),
          pinned: pinnedSet.has(id),
          cwd: '',
          ungrouped: !memberIds.has(id),
        }
      }
    }

    // 自动化任务：按参与会话聚合
    const tasks = []
    try {
      const listed = schedule ? await schedule.list({ active: true }) : []
      const rows = Array.isArray(listed) ? listed : (listed && listed.items) || []
      for (const task of rows) {
        tasks.push({
          id: task.id,
          title: task.title || '',
          status: task.status || '',
          sessionIds: task.involvedSessionIds || [],
          target: task.target || null,
        })
      }
    } catch (error) {
      appendReport('host-error', { where: 'schedule.list', message: String((error && error.message) || error) })
    }

    const version = [
      workspaces.length,
      items.length,
      pinned.length,
      archived.length,
      tasks.length,
      latestUpdated,
    ].join(':')

    return {
      version,
      generatedAt: Date.now(),
      workspaces,
      pinned,
      archived,
      sessions,
      tasks,
    }
  }

  let dataCache = { version: '', value: null, at: 0 }

  async function data(force = false) {
    if (!force && dataCache.value && Date.now() - dataCache.at < 4000) return dataCache.value
    const value = await buildData()
    dataCache = { version: value.version, value, at: Date.now() }
    return value
  }

  async function version() {
    const d = await data()
    return { version: d.version, generatedAt: d.generatedAt }
  }

  async function act(payload) {
    const registry = get('workspaceRegistry')
    const verb = payload && payload.verb
    const sessionId = payload && payload.sessionId
    try {
      if (!registry) return { ok: false, error: 'no-registry' }
      if (verb === 'pin') await registry.pinSession(sessionId)
      else if (verb === 'unpin') await registry.unpinSession(sessionId)
      else if (verb === 'archive') await registry.archiveSession(sessionId, {})
      else if (verb === 'unarchive') await registry.unarchiveSession(sessionId)
      else return { ok: false, error: 'unknown-verb' }
      dataCache = { version: '', value: null, at: 0 }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) }
    }
  }

  function register(routePath, handler) {
    try {
      ctx.webServer.register({ path: routePath, handler })
      tried.push(`${routePath} -> ok`)
      return true
    } catch (error) {
      tried.push(`${routePath} -> fail: ${String((error && error.message) || error)}`)
      return false
    }
  }

  const versionHandler = async () => json(await version())
  const dataHandler = async () => json(await data(true))
  const actHandler = async (request) => {
    const body = await request.json().catch(() => null)
    return json(await act(body))
  }
  const reportHandler = async (request) => {
    const body = await request.json().catch(() => null)
    const written = appendReport('client-report', body)
    return json({ ok: written === true, written })
  }

  register('/sidebar-cards/ping', async () => json({ ok: true, at: Date.now() }))
  register('/api/sidebar-cards/ping', async () => json({ ok: true, at: Date.now() }))

  // 不在 /api 前缀下也能用（/api 由连接层统一接管并做浏览器鉴权）
  register('/sidebar-cards/version', versionHandler)
  register('/sidebar-cards/data', dataHandler)
  register('/sidebar-cards/act', actHandler)
  register('/sidebar-cards/report', reportHandler)

  // 保留 /api 路径作为备选
  register('/api/sidebar-cards/version', versionHandler)
  register('/api/sidebar-cards/data', dataHandler)
  register('/api/sidebar-cards/act', actHandler)
  register('/api/sidebar-cards/report', reportHandler)

  appendReport('host-boot', { tried, registered: tried.filter((line) => line.endsWith('ok')).length })

  // Host 侧自检：把聚合结果摘要写盘，便于没有浏览器时验证
  Promise.resolve()
    .then(() => data(true))
    .then((snapshot) => {
      const sessions = Object.values(snapshot.sessions || {})
      const weekly = sessions.filter((session) => session.createdAt && Date.now() - session.createdAt <= 7 * 24 * 3600 * 1000 && !session.archived)
      appendReport('host-data', {
        version: snapshot.version,
        counts: {
          workspaces: snapshot.workspaces.length,
          sessions: sessions.length,
          pinned: snapshot.pinned.length,
          archived: snapshot.archived.length,
          tasks: snapshot.tasks.length,
          weekly: weekly.length,
          ungrouped: sessions.filter((session) => session.ungrouped).length,
        },
        workspaceSample: snapshot.workspaces.slice(0, 2),
        sessionSample: sessions.slice(0, 2),
        taskSample: (snapshot.tasks || []).slice(0, 2),
      })
    })
    .catch((error) => appendReport('host-error', { where: 'self-check', message: String((error && error.stack) || error) }))
}
