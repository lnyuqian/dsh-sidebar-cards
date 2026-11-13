/**
 * dsh-sidebar-cards · Client 半边
 *
 * 替换 DSH 左侧栏的「会话浏览区」（sidebar.workspaces），改为 5 张卡片：
 *   插件 / 一周会话 / 置顶会话 / 自动化任务会话 / 工作区
 *
 * 数据来源：DSH 官方 Remote 通道（ctx.remote.workspace.follow / session.list / schedule.list），
 * 与官方侧栏同一条路，不需要自建 HTTP 路由（自建路由拿不到页面鉴权会被挂住）。
 * 自建 HTTP 仅作为兜底：Remote 不可用时才用。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-cards',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const LS_PREFIX = 'dsh.sidebarCards.v2.'
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000

    /* ---------------------------- 小工具 ---------------------------- */

    function lsGet(key, fallback) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + key)
        return raw ? JSON.parse(raw) : fallback
      } catch {
        return fallback
      }
    }
    function lsSet(key, value) {
      try {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
      } catch {
        /* ignore */
      }
    }

    function relTime(ts) {
      if (!ts) return ''
      const diff = Date.now() - ts
      if (diff < 60 * 1000) return '刚刚'
      const min = Math.floor(diff / 60000)
      if (min < 60) return min + '分'
      const hours = Math.floor(min / 60)
      if (hours < 24) return hours + '时'
      const days = Math.floor(hours / 24)
      if (days === 1) return '昨天'
      if (days < 7) return days + '天'
      return Math.floor(days / 7) + '周'
    }

    function dayBucket(ts) {
      const now = new Date()
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      if (ts >= startOfToday) return '今天'
      if (ts >= startOfToday - 86400000) return '昨天'
      return '本周'
    }

    function sessionTitle(session) {
      return (session && session.title ? String(session.title) : '').trim() || '未命名'
    }

    function remoteNamespace(ctx, name) {
      try {
        if (ctx && typeof ctx.get === 'function') {
          const direct = ctx.get('remote.' + name)
          if (direct) return direct
        }
      } catch {
        /* 继续尝试父对象 */
      }
      try {
        const remote = ctx && ctx.remote
        if (!remote) return null
        return remote[name] || null
      } catch {
        return null
      }
    }

    const LIST_KEYS = ['items', 'rows', 'sessions', 'workspaces', 'tasks', 'list', 'values', 'entries']
    const WRAP_KEYS = [
      'value',
      'data',
      'state',
      'payload',
      'snapshot',
      'result',
      'frame',
      'body',
      'content',
      'current',
      'projections',
      'projection',
      'values',
      'value',
      'summary',
      'metadata',
      'meta',
      'header',
      'details',
      'info',
    ]

    function findArrayDeep(value, keys, depth) {
      const level = depth || 0
      if (!value || level > 4) return []
      if (Array.isArray(value)) return value
      if (typeof value !== 'object') return []
      for (const key of keys) {
        const candidate = value[key]
        if (Array.isArray(candidate) && candidate.length) return candidate
      }
      for (const key of WRAP_KEYS.concat(keys)) {
        const candidate = value[key]
        if (candidate && typeof candidate === 'object') {
          const found = findArrayDeep(candidate, keys, level + 1)
          if (found.length) return found
        }
      }
      return []
    }

    function findDeep(value, keys, depth) {
      const level = depth || 0
      if (!value || typeof value !== 'object' || level > 4) return undefined
      for (const key of keys) {
        if (value[key] !== undefined && value[key] !== null) return value[key]
      }
      for (const key of WRAP_KEYS) {
        const candidate = value[key]
        if (candidate && typeof candidate === 'object') {
          const found = findDeep(candidate, keys, level + 1)
          if (found !== undefined) return found
        }
      }
      return undefined
    }

    function firstOf(object, keys) {
      if (!object) return undefined
      for (const key of keys) {
        if (object[key] !== undefined && object[key] !== null) return object[key]
      }
      return undefined
    }

    /* ---------------------------- 图标 ---------------------------- */

    function svg(props, children) {
      return h(
        'svg',
        Object.assign({ width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }, props),
        children,
      )
    }
    const ChevronDown = (p) => svg(Object.assign({ width: 12, height: 12 }, p), h('path', { d: 'M2.4 4.4L6 8l3.6-3.6' }))
    const ChevronRight = (p) => svg(Object.assign({ width: 12, height: 12 }, p), h('path', { d: 'M4.4 2.4L8 6l-3.6 3.6' }))
    const IcoSearch = (p) => svg(Object.assign({ width: 15, height: 15 }, p), [h('circle', { key: 'c', cx: 7, cy: 7, r: 4.4 }), h('path', { key: 'p', d: 'M10.4 10.4L14 14' })])
    const IcoList = (p) => svg(Object.assign({ width: 15, height: 15 }, p), h('path', { d: 'M2.5 4.5h11M2.5 8h7.5M2.5 11.5h11' }))
    const IcoPlus = (p) => svg(Object.assign({ width: 15, height: 15 }, p), h('path', { d: 'M8 2.8v10.4M2.8 8h10.4' }))
    const IcoPin = (p) => h('svg', Object.assign({ width: 13, height: 13, viewBox: '0 0 16 16', fill: 'currentColor' }, p), h('path', { d: 'M9.2 1.6l5.2 5.2-2.5 2.5-1.4-1.4-2.9 2.9-.2 3-1.4 1.4-2.1-3.2-3.2-2.1L2.1 8.5l3-.2 2.9-2.9L6.6 4 9.2 1.6z' }))
    const IcoClock = (p) => svg(Object.assign({ width: 13, height: 13 }, p), [h('circle', { key: 'c', cx: 8, cy: 8, r: 6 }), h('path', { key: 'p', d: 'M8 4.6V8l2.4 1.5' })])
    const IcoFolder = (p) => svg(Object.assign({ width: 14, height: 14 }, p), h('path', { d: 'M2 4.6c0-.6.4-1 1-1h3l1.4 1.6H13c.6 0 1 .4 1 1v5.2c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V4.6z' }))
    const IcoGrid = (p) =>
      svg(Object.assign({ width: 16, height: 16 }, p), [
        h('rect', { key: 1, x: 2.4, y: 2.4, width: 4.6, height: 4.6, rx: 1.2 }),
        h('rect', { key: 2, x: 9, y: 2.4, width: 4.6, height: 4.6, rx: 1.2 }),
        h('rect', { key: 3, x: 2.4, y: 9, width: 4.6, height: 4.6, rx: 1.2 }),
        h('rect', { key: 4, x: 9, y: 9, width: 4.6, height: 4.6, rx: 1.2 }),
      ])
    const IcoArt = (p) =>
      svg(Object.assign({ width: 16, height: 16 }, p), [
        h('rect', { key: 'r', x: 2.6, y: 2.6, width: 10.8, height: 10.8, rx: 2 }),
        h('path', { key: 'p', d: 'M2.6 9.4l3-2.6 3 2.6 2.2-1.8 2.6 2' }),
      ])
    const IcoDots = (p) =>
      h(
        'svg',
        Object.assign({ width: 16, height: 16, viewBox: '0 0 16 16', fill: 'currentColor' }, p),
        [3.4, 8, 12.6].map((cx, index) => h('circle', { key: index, cx, cy: 8, r: 1.1 })),
      )

    /* ---------------------------- 数据层 ---------------------------- */

    const EMPTY_MODEL = {
      version: '',
      workspaces: [],
      pinned: [],
      archived: [],
      sessions: {},
      tasks: [],
      diag: {},
    }

    function toMs(value) {
      if (!value) return 0
      if (typeof value === 'number') return value
      const parsed = Date.parse(String(value))
      return Number.isFinite(parsed) ? parsed : 0
    }

    function normalizeSessionRow(row) {
      if (!row || typeof row !== 'object') return null
      const id = firstOf(row, ['sessionId', 'id'])
      if (!id) return null
      const title = findDeep(row, ['title', 'displayTitle', 'name', 'summary']) || ''
      // 子代理会话：带 parentSessionId 或 origin=subagent，一律不进侧栏
      const parentSessionId = firstOf(row, ['parentSessionId', 'parentSession'])
      const origin = firstOf(row, ['origin'])
      const subagent = !!parentSessionId || origin === 'subagent'
      const updatedAt = toMs(findDeep(row, ['updatedAt', 'lastUpdatedAt', 'updated']))
      const createdAt = toMs(findDeep(row, ['createdAt', 'created']))
      return {
        id,
        title: typeof title === 'string' ? title : '',
        createdAt,
        updatedAt,
        subagent,
        running: !!firstOf(row, ['running', 'isRunning']),
        blank: !!firstOf(row, ['blank', 'isBlank']),
        cwd: firstOf(row, ['cwd', 'workingDirectory']) || '',
        archived: false,
        pinned: false,
      }
    }

    function normalizeSessionList(listed) {
      const rows = findArrayDeep(listed, LIST_KEYS)
      const out = {}
      for (const row of rows) {
        const normalized = normalizeSessionRow(row)
        if (!normalized) continue
        if (normalized.subagent) continue
        out[normalized.id] = normalized
      }
      return out
    }

    function normalizeWorkspaceList(listed) {
      const rows = findArrayDeep(listed, LIST_KEYS)
      const out = []
      for (const workspace of rows) {
        if (!workspace || typeof workspace !== 'object') continue
        const id = firstOf(workspace, ['id', 'workspaceId'])
        if (!id) continue
        const sessionIds = firstOf(workspace, ['sessionIds', 'sessions']) || []
        out.push({
          id,
          title: firstOf(workspace, ['title', 'name']) || '',
          path: firstOf(workspace, ['path', 'directory']) || '',
          sessionIds: Array.isArray(sessionIds) ? sessionIds.slice() : [],
        })
      }
      return out
    }

    function normalizeTasks(listed) {
      const rows = findArrayDeep(listed, LIST_KEYS)
      const out = []
      for (const task of rows) {
        if (!task || typeof task !== 'object') continue
        const sessionIds = firstOf(task, ['involvedSessionIds', 'sessionIds']) || []
        out.push({
          id: firstOf(task, ['id', 'taskId']) || '',
          title: firstOf(task, ['title', 'name']) || '',
          status: firstOf(task, ['status', 'state']) || '',
          sessionIds: Array.isArray(sessionIds) ? sessionIds.slice() : [],
        })
      }
      return out
    }

    function buildVersion(model) {
      let latest = 0
      for (const session of Object.values(model.sessions || {})) {
        if (session.updatedAt > latest) latest = session.updatedAt
      }
      return [model.workspaces.length, Object.keys(model.sessions || {}).length, (model.pinned || []).length, (model.archived || []).length, (model.tasks || []).length, latest].join(':')
    }

    function applyWorkspaceFrame(model, frame) {
      if (!frame || typeof frame !== 'object') return
      const body = frame.value && typeof frame.value === 'object' ? frame.value : frame.data && typeof frame.data === 'object' ? frame.data : frame
      const type = String(frame.type || body.type || '')
      const baseline = type === 'baseline' || type === 'replace'
      if (baseline) {
        const workspaces = normalizeWorkspaceList(body)
        if (workspaces.length || Array.isArray(firstOf(body, ['workspaces', 'items', 'rows']))) {
          model.workspaces = workspaces
        }
        const order = findDeep(body, ['order', 'workspaceIds'])
        if (Array.isArray(order) && model.workspaces.length) {
          const index = new Map(model.workspaces.map((workspace) => [workspace.id, workspace]))
          const sorted = order.map((id) => index.get(id)).filter(Boolean)
          for (const workspace of model.workspaces) if (!sorted.includes(workspace)) sorted.push(workspace)
          model.workspaces = sorted
        }
        const pinned = findDeep(body, ['pinned', 'pinnedSessionIds', 'pins'])
        if (Array.isArray(pinned)) model.pinned = pinned.slice()
        const archived = findDeep(body, ['archived', 'archivedSessionIds', 'archives'])
        if (Array.isArray(archived)) model.archived = archived.slice()
        return
      }
      if (type === 'upsert') {
        const next = normalizeWorkspaceList({ items: [firstOf(frame, ['workspace', 'value']) || frame] })
        if (next.length) {
          const id = next[0].id
          const index = model.workspaces.findIndex((workspace) => workspace.id === id)
          if (index >= 0) model.workspaces[index] = next[0]
          else model.workspaces.push(next[0])
        }
        return
      }
      if (type === 'remove') {
        const id = firstOf(frame, ['id', 'workspaceId'])
        if (id) model.workspaces = model.workspaces.filter((workspace) => workspace.id !== id)
        return
      }
      if (type === 'order') {
        const order = firstOf(frame, ['order', 'workspaceIds'])
        if (Array.isArray(order)) {
          const index = new Map(model.workspaces.map((workspace) => [workspace.id, workspace]))
          model.workspaces = order.map((id) => index.get(id)).filter(Boolean)
        }
        return
      }
      if (type === 'pinned') {
        const pinned = firstOf(frame, ['pinned', 'pinnedSessionIds', 'ids', 'value'])
        if (Array.isArray(pinned)) model.pinned = pinned.slice()
        return
      }
      if (type === 'archived') {
        const archived = firstOf(frame, ['archived', 'archivedSessionIds', 'ids', 'value'])
        if (Array.isArray(archived)) model.archived = archived.slice()
      }
    }

    function useSidebarData(ctx) {
      const [state, setState] = useState({ status: 'loading', data: null, error: '' })
      const modelRef = useRef(Object.assign({}, EMPTY_MODEL))

      const publish = useCallback(() => {
        const model = modelRef.current
        const pinnedSet = new Set(model.pinned || [])
        const archivedSet = new Set(model.archived || [])
        const memberIds = new Set()
        for (const workspace of model.workspaces) for (const id of workspace.sessionIds || []) memberIds.add(id)
        for (const id of Object.keys(model.sessions)) {
          const session = model.sessions[id]
          session.pinned = pinnedSet.has(id)
          session.archived = archivedSet.has(id)
          session.ungrouped = !memberIds.has(id)
        }
        model.version = buildVersion(model)
        model.diag = Object.assign({}, model.diag, {
          sessionCount: Object.keys(model.sessions).length,
          workspaceCount: model.workspaces.length,
          pinnedCount: (model.pinned || []).length,
          archivedCount: (model.archived || []).length,
          taskCount: (model.tasks || []).length,
        })
        setState({ status: 'ready', data: Object.assign({}, model), error: '' })
      }, [])

      const applyHttp = useCallback(async () => {
        try {
          const controller = new AbortController()
          const abortTimer = setTimeout(() => controller.abort(), 3000)
          const response = await fetch('/sidebar-cards/data', { credentials: 'same-origin', signal: controller.signal })
          clearTimeout(abortTimer)
          if (!response.ok) return false
          const payload = await response.json()
          const model = modelRef.current
          model.workspaces = normalizeWorkspaceList(payload.workspaces || [])
          model.pinned = payload.pinned || []
          model.archived = payload.archived || []
          model.sessions = payload.sessions || {}
          model.tasks = normalizeTasks(payload.tasks || [])
          model.diag.http = 'ok'
          publish()
          return true
        } catch {
          return false
        }
      }, [publish])

      const resolveRemote = useCallback(() => {
        const session = remoteNamespace(ctx, 'session')
        const workspace = remoteNamespace(ctx, 'workspace')
        if (!session && !workspace) return null
        return { session, workspace, schedule: remoteNamespace(ctx, 'schedule') }
      }, [ctx])

      useEffect(() => {
        let disposed = false
        const abort = new AbortController()
        const timers = []
        let waitTimer = null
        let hardTimeout = null

        const fail = (message) => {
          if (disposed) return
          setState((prev) => (prev.data ? prev : { status: 'error', data: null, error: message }))
        }

        async function pullSessions() {
          try {
            const sessionNs = remoteNamespace(ctx, 'session')
            if (!sessionNs) {
              modelRef.current.diag.session = 'ns-missing'
              return
            }
            let listMethod = null
            for (const name of ['list', 'listState', 'state', 'catalog', 'all']) {
              if (typeof sessionNs[name] === 'function') {
                listMethod = sessionNs[name].bind(sessionNs)
                modelRef.current.diag.sessionMethod = name
                break
              }
            }
            if (!listMethod) {
              modelRef.current.diag.session = 'no-method:' + Object.keys(sessionNs).slice(0, 14).join(',')
              return
            }
            let listed = null
            let lastError = null
            for (const arg of [{}, { limit: 1000 }, { offset: 0, limit: 1000 }]) {
              try {
                listed = await listMethod(arg)
                lastError = null
                break
              } catch (error) {
                lastError = error
              }
            }
            if (lastError) throw lastError
            if (!modelRef.current.diag.sessionRaw) {
              try {
                modelRef.current.diag.sessionRaw = JSON.stringify(listed).slice(0, 260)
              } catch {
                modelRef.current.diag.sessionRaw = '(unserializable)'
              }
            }
            if (disposed) return
            const next = normalizeSessionList(listed)
            modelRef.current.diag.session = Object.keys(next).length ? 'ok:' + Object.keys(next).length : 'empty'
            if (!modelRef.current.diag.rowRaw) {
              try {
                const sampleRow = findArrayDeep(listed, LIST_KEYS).slice(0, 1)
                modelRef.current.diag.rowRaw = JSON.stringify(sampleRow).slice(0, 500)
              } catch {
                modelRef.current.diag.rowRaw = '(unserializable)'
              }
            }
            if (Object.keys(next).length) {
              modelRef.current.sessions = next
              publish()
            }
          } catch (error) {
            modelRef.current.diag.session = 'err:' + String((error && error.message) || error).slice(0, 90)
            if (!disposed) console.warn('[sidebar-cards] session.list 失败', error)
          }
        }

        async function pullTasks() {
          try {
            const scheduleNs = remoteNamespace(ctx, 'schedule')
            if (!scheduleNs) {
              modelRef.current.diag.schedule = 'ns-missing'
              return
            }
            let scheduleMethod = null
            for (const name of ['list', 'catalog']) {
              if (typeof scheduleNs[name] === 'function') {
                scheduleMethod = scheduleNs[name].bind(scheduleNs)
                break
              }
            }
            if (!scheduleMethod) {
              modelRef.current.diag.schedule = 'no-method:' + Object.keys(scheduleNs).slice(0, 14).join(',')
              return
            }
            const listed = await scheduleMethod({ active: true })
            if (disposed) return
            modelRef.current.tasks = normalizeTasks(listed)
            modelRef.current.diag.schedule = 'ok:' + modelRef.current.tasks.length
            publish()
          } catch (error) {
            modelRef.current.diag.schedule = 'err:' + String((error && error.message) || error).slice(0, 90)
            if (!disposed) console.warn('[sidebar-cards] schedule.list 失败', error)
          }
        }

        async function followWorkspaces(remote) {
          try {
            if (!remote || !remote.workspace || typeof remote.workspace.follow !== 'function') return false
            const stream = await remote.workspace.follow(abort.signal)
            if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') return false
            modelRef.current.diag.workspace = 'stream'
            for await (const frame of stream) {
              if (disposed) break
              modelRef.current.diag.workspace = 'frame:' + String((frame && frame.type) || '?')
              if (!modelRef.current.diag.frameRaw) {
                try {
                  modelRef.current.diag.frameRaw = JSON.stringify(frame).slice(0, 900)
                } catch {
                  modelRef.current.diag.frameRaw = '(unserializable)'
                }
              }
              applyWorkspaceFrame(modelRef.current, frame)
              publish()
            }
            return true
          } catch (error) {
            modelRef.current.diag.workspace = 'err:' + String((error && error.message) || error).slice(0, 90)
            if (!disposed) console.warn('[sidebar-cards] workspace.follow 失败', error)
            return false
          }
        }

        async function pullViaSearch() {
          try {
            const sessionsService = ctx && typeof ctx.get === 'function' ? ctx.get('sessions') : null
            if (!sessionsService || typeof sessionsService.search !== 'function') {
              modelRef.current.diag.search = 'ns-missing'
              return
            }
            const controller = new AbortController()
            const result = await sessionsService.search('', controller.signal)
            modelRef.current.diag.search = 'called'
            if (!modelRef.current.diag.searchRaw) {
              try {
                modelRef.current.diag.searchRaw = JSON.stringify(result).slice(0, 240)
              } catch {
                modelRef.current.diag.searchRaw = '(unserializable)'
              }
            }
            const value = result && (result.value || result.data || result)
            const rows = findArrayDeep(value, LIST_KEYS)
            if (rows.length) {
              modelRef.current.sessions = normalizeSessionList(rows)
              publish()
            }
          } catch (error) {
            modelRef.current.diag.search = 'err:' + String((error && error.message) || error).slice(0, 80)
          }
        }

        async function start(remote) {
          followWorkspaces(remote).then((followed) => {
            if (followed || disposed) return
            applyHttp().then((ok) => {
              if (!ok) fail('未连接到会话数据通道')
            })
          })
          await pullSessions()
          await pullTasks()
          await pullViaSearch()
          let fast = 0
          const fastTimer = setInterval(() => {
            fast += 1
            if (disposed) return
            if (!Object.keys(modelRef.current.sessions).length) pullSessions()
            if (!modelRef.current.tasks.length) pullTasks()
            if (fast >= 15) clearInterval(fastTimer)
          }, 2000)
          timers.push(fastTimer)
          timers.push(setInterval(() => { if (!disposed && !document.hidden) pullSessions() }, 15000))
          timers.push(setInterval(() => { if (!disposed && !document.hidden) pullTasks() }, 60000))
        }

        const kick = () => {
          const remote = resolveRemote()
          if (remote) {
            start(remote)
            return
          }
          waitTimer = setInterval(() => {
            const next = resolveRemote()
            if (next) {
              clearInterval(waitTimer)
              waitTimer = null
              start(next)
            }
          }, 500)
        }
        kick()

        hardTimeout = setTimeout(() => {
          if (disposed) return
          applyHttp().then((ok) => {
            if (!ok) fail('数据通道无响应')
          })
        }, 15000)

        return () => {
          disposed = true
          if (waitTimer) clearInterval(waitTimer)
          timers.forEach((timer) => clearInterval(timer))
          clearTimeout(hardTimeout)
          abort.abort()
        }
      }, [applyHttp, publish, resolveRemote])

      const refetch = useCallback(async () => {
        const remote = resolveRemote()
        try {
          if (remote && remote.session && remote.session.list) {
            modelRef.current.sessions = normalizeSessionList(await remote.session.list())
            publish()
            return
          }
        } catch {
          /* ignore */
        }
        await applyHttp()
      }, [applyHttp, publish, resolveRemote])

      const ingest = useCallback(
        (sessionsValue) => {
          if (!sessionsValue) return
          const normalized = normalizeSessionList(sessionsValue)
          if (!Object.keys(normalized).length) return
          modelRef.current.sessions = normalized
          publish()
        },
        [publish],
      )

      const ingestWorkspaces = useCallback(
        (workspacesValue) => {
          if (!workspacesValue) return
          const normalized = normalizeWorkspaceList(workspacesValue)
          if (!normalized.length) return
          modelRef.current.workspaces = normalized
          publish()
        },
        [publish],
      )

      const ingestDiag = useCallback(
        (patch) => {
          modelRef.current.diag = Object.assign({}, modelRef.current.diag, patch)
          publish()
        },
        [publish],
      )

      return Object.assign({ refetch, ingest, ingestWorkspaces, ingestDiag }, state)
    }

    async function act(ctx, verb, sessionId) {
      const workspace = remoteNamespace(ctx, 'workspace')
      const methodName = { pin: 'pinSession', unpin: 'unpinSession', archive: 'archiveSession', unarchive: 'unarchiveSession' }[verb]
      const method = workspace && methodName ? workspace[methodName] : null
      if (method) {
        const attempts = [() => method({ sessionId }), () => method(sessionId)]
        for (const attempt of attempts) {
          try {
            const result = await attempt()
            if (result && result.ok === false) continue
            return { ok: true }
          } catch {
            /* try next shape */
          }
        }
      }
      try {
        const response = await fetch('/sidebar-cards/act', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ verb, sessionId }),
        })
        return await response.json()
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) }
      }
    }

    /* ---------------------------- 动作 ---------------------------- */

    function openSession(ctx, id) {
      const attempts = []
      let ui = null
      try {
        ui = (ctx.get && ctx.get('uiWorkspace')) || ctx.uiWorkspace
      } catch {
        ui = null
      }
      if (ui && typeof ui.openSession === 'function') {
        attempts.push(() => ui.openSession(id))
        attempts.push(() => ui.openSession({ sessionId: id }))
        attempts.push(() => ui.openSession({ kind: 'session', sessionId: id }))
      }
      for (const attempt of attempts) {
        try {
          attempt()
          try {
            window.__DSC_LAST = 'open ok: ' + String(id)
          } catch {
            /* ignore */
          }
          return
        } catch (error) {
          try {
            window.__DSC_LAST = 'open err: ' + String((error && error.message) || error)
          } catch {
            /* ignore */
          }
        }
      }
      try {
        const layout = (ctx.get && ctx.get('layout')) || ctx.layout
        if (layout && layout.selectPanel) layout.selectPanel('conversation')
      } catch {
        /* ignore */
      }
    }

    function startSession(ctx, workspaceId) {
      try {
        const ui = (ctx.get && ctx.get('uiWorkspace')) || ctx.uiWorkspace
        if (ui && ui.startSession) ui.startSession(workspaceId)
      } catch {
        /* ignore */
      }
    }

    function selectPanel(ctx, label) {
      const layout = (ctx.get && ctx.get('layout')) || ctx.layout
      const candidates =
        {
          插件: ['plugins', 'plugin'],
          自动化任务: ['schedules', 'schedule', 'automation'],
          作品: ['creations', 'creation', 'works'],
        }[label] || []
      for (const id of candidates) {
        try {
          if (layout && layout.selectPanel) {
            layout.selectPanel(id)
            return
          }
        } catch {
          /* try next */
        }
      }
      try {
        const root = document.querySelector('.dsc-root')
        const scope = (root && root.closest('aside, nav, [class*="sidebar" i]')) || document.body
        const nodes = Array.from(scope.querySelectorAll('button, [role="button"], a'))
        const hit = nodes.find((node) => (node.textContent || '').trim() === label && !(root && root.contains(node)))
        if (hit) hit.click()
      } catch {
        /* ignore */
      }
    }

    /* ---------------------------- 样式 ---------------------------- */

    const STYLE_TEXT = `
      .dsc-root{display:flex;flex-direction:column;align-items:stretch;gap:4px;height:100%;min-height:320px;overflow-y:auto;overflow-x:hidden;padding:0 14px 10px 2px;box-sizing:border-box;}
      .dsc-top-space{flex:0 0 6px;height:6px;}
      /* 用户 2026-11-13（第2版）：每张卡片是独立完整框（标题行 + 内容同框），卡间 4px；宽度对齐上方「新建会话」按钮 */
      .dsc-root::-webkit-scrollbar{width:6px;}
      .dsc-root::-webkit-scrollbar-thumb{background:rgba(0,0,0,.14);border-radius:3px;}
      .dsc-card{display:flex !important;flex-direction:column !important;align-items:stretch !important;justify-content:flex-start !important;width:100% !important;margin:0 !important;padding:0 !important;background:var(--dsw-alias-bg-layer-1,#fff) !important;border-radius:8px !important;box-shadow:0 0 0 1px rgba(0,0,0,.06) !important;overflow:hidden !important;flex:0 0 auto !important;box-sizing:border-box !important;}
      .dsc-card.dsc-collapsed{background:transparent !important;box-shadow:none !important;overflow:visible !important;}
      .dsc-head{flex:0 0 30px !important;position:sticky;top:0;z-index:3;display:flex;align-items:center;width:100% !important;box-sizing:border-box !important;height:30px !important;margin:0 !important;padding:0 12px 0 12px !important;background:#e3e3e3;border-radius:0;cursor:pointer;user-select:none;}
      .dsc-card.dsc-collapsed .dsc-head{border-radius:8px;}
      .dsc-title{font-size:15px;font-weight:700;color:#1c1c1c;letter-spacing:.01em;white-space:nowrap;}
      .dsc-count{font-size:11px;font-weight:600;color:#6a6a6a;background:rgba(0,0,0,.07);border-radius:9px;padding:1px 6px;margin-left:7px;}
      .dsc-arrow{margin-left:auto;width:20px;height:20px;display:grid;place-items:center;color:#5a5a5a;border-radius:4px;flex:0 0 20px;}
      .dsc-arrow:hover{background:rgba(0,0,0,.06);}
      .dsc-hacts{margin-left:auto;display:flex;align-items:center;gap:6px;color:#4d4d4d;}
      .dsc-hact{width:20px;height:20px;display:grid;place-items:center;border-radius:4px;cursor:pointer;}
      .dsc-hact:hover{background:rgba(0,0,0,.08);}
      .dsc-body{padding:4px 4px 6px;}
      .dsc-row{display:flex;align-items:center;gap:7px;height:30px;padding:0 8px;border-radius:6px;font-size:13px;color:var(--dsw-alias-label-primary,#262626);cursor:pointer;user-select:none;}
      .dsc-row:hover{background:rgba(0,0,0,.045);}
      .dsc-row.dsc-active{background:rgba(0,0,0,.07);font-weight:600;}
      .dsc-lead{width:14px;height:14px;flex:0 0 14px;display:grid;place-items:center;color:#9e9e9e;}
      .dsc-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .dsc-tag{flex:0 0 auto;max-width:70px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:15px;color:#6d6d6d;background:#ececec;border-radius:3px;padding:0 4px;}
      .dsc-time{flex:0 0 auto;font-size:11px;color:var(--dsw-alias-label-secondary,#a5a5a5);font-variant-numeric:tabular-nums;}
      .dsc-day{display:flex;align-items:center;gap:6px;height:22px;padding:0 8px;font-size:11px;color:#9a9a9a;}
      .dsc-day:after{content:"";flex:1;height:1px;background:rgba(0,0,0,.05);}
      .dsc-ws{display:flex;align-items:center;gap:7px;height:30px;padding:0 8px;border-radius:6px;font-size:13px;color:#1f1f1f;cursor:pointer;}
      .dsc-ws:hover{background:rgba(0,0,0,.045);}
      .dsc-ws .dsc-lead{color:#8b8b8b;}
      .dsc-wn{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600;font-size:13px;}
      .dsc-wc{font-size:11px;color:#a2a2a2;}
      .dsc-ws-actions{display:flex;align-items:center;gap:2px;opacity:1;}
      .dsc-ws-actions .dsc-hact{color:#e9e9e9;}
      .dsc-ws-actions .dsc-hact:hover{color:#4d4d4d;background:rgba(0,0,0,.06);}
      .dsc-ws-body{padding-left:14px;}
      .dsc-panel-host{display:flex;flex-direction:column;}
      .dsc-panel-host nav{display:flex;flex-direction:column;width:100%;}
      .dsc-prow{display:flex;align-items:center;gap:8px;height:30px;padding:0 8px;border-radius:7px;font-size:13.5px;color:#2d2d2d;cursor:pointer;}
      .dsc-prow:hover{background:rgba(0,0,0,.045);}
      .dsc-more{display:flex;align-items:center;height:26px;padding:0 8px;font-size:12px;color:#7d7d7d;cursor:pointer;border-radius:6px;}
      .dsc-more:hover{background:rgba(0,0,0,.045);color:#4a4a4a;}
      .dsc-search{display:flex;align-items:center;gap:6px;margin:2px 4px 6px;padding:0 8px;height:28px;border-radius:6px;background:rgba(0,0,0,.05);}
      .dsc-search input{flex:1;border:none;outline:none;background:transparent;font-size:13px;color:#262626;min-width:0;}
      .dsc-menu{position:fixed;z-index:90;min-width:132px;background:#fff;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.05);padding:4px;}
      .dsc-menu-item{display:flex;align-items:center;height:28px;padding:0 10px;border-radius:6px;font-size:13px;color:#262626;cursor:pointer;white-space:nowrap;}
      .dsc-menu-item:hover{background:rgba(0,0,0,.06);}
      .dsc-menu-item.danger{color:#b4423a;}
      .dsc-skeleton{flex:0 0 auto;height:30px;border-radius:8px;background:rgba(0,0,0,.035);}
      .dsc-status{padding:10px 12px;font-size:12px;color:#8a8a8a;line-height:1.6;}
      .dsc-status button{margin-top:6px;border:1px solid #d8d8d8;background:#fff;border-radius:6px;font-size:12px;padding:3px 10px;cursor:pointer;}
    `

    /* -------------------- 卡片标题行风格（08 / 05） -------------------- */

    const HEAD_GLASS = {
      background:
        'linear-gradient(180deg, rgba(255,255,255,.65) 0%, rgba(255,255,255,.10) 100%),' +
        'radial-gradient(90% 140% at 15% -25%, rgba(255,255,255,.9) 0%, rgba(255,255,255,0) 60%),' +
        'linear-gradient(135deg,#E6EAEE 0%,#D3D7DB 100%)',
      backdropFilter: 'blur(6px)',
      WebkitBackdropFilter: 'blur(6px)',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(255,255,255,.45),' +
        'inset 0 -3px 6px rgba(0,0,0,.06), 0 1px 1px rgba(0,0,0,.06)',
    }

    const HEAD_SELECTED = {
      background:
        'linear-gradient(180deg, rgba(255,255,255,.55) 0%, rgba(255,255,255,0) 38%),' +
        'radial-gradient(85% 130% at 16% -25%, rgba(255,255,255,.95) 0%, rgba(255,255,255,0) 58%),' +
        'linear-gradient(0deg, rgba(255,255,255,.35) 0%, rgba(255,255,255,0) 9%),' +
        'linear-gradient(160deg,#EBEBEB 0%,#DCDDDF 55%,#C4C5C7 100%)',
      boxShadow:
        'inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(255,255,255,.45),' +
        'inset 0 -3px 6px rgba(0,0,0,.06), 0 1px 1px rgba(0,0,0,.06)',
    }

    /* ---------------------------- 行菜单 ---------------------------- */

    function Menu({ state, onClose }) {
      useEffect(() => {
        if (!state) return undefined
        const onDown = (event) => {
          if (event.target && event.target.closest && event.target.closest('.dsc-menu')) return
          onClose()
        }
        const onKey = (event) => {
          if (event.key === 'Escape') onClose()
        }
        window.addEventListener('mousedown', onDown, true)
        window.addEventListener('keydown', onKey)
        return () => {
          window.removeEventListener('mousedown', onDown, true)
          window.removeEventListener('keydown', onKey)
        }
      }, [state, onClose])
      if (!state) return null
      return h(
        'div',
        { className: 'dsc-menu', style: { left: state.x, top: state.y } },
        state.items.map((item, index) =>
          h(
            'div',
            {
              key: index,
              className: 'dsc-menu-item' + (item.danger ? ' danger' : ''),
              onClick: () => {
                onClose()
                item.onSelect && item.onSelect()
              },
            },
            item.label,
          ),
        ),
      )
    }

    /* ---------------------------- 会话行 ---------------------------- */

    function SessionRow({ ctx, session, workspaceTitle, showTag, leadingIcon, activeId, onMenu, onOpen }) {
      return h(
        'div',
        {
          className: 'dsc-row' + (activeId === session.id ? ' dsc-active' : ''),
          'data-session-id': session.id,
          draggable: true,
          title: session.title || '',
          onDragStart: (event) => {
            try {
              event.dataTransfer.setData('text/dsh-session', session.id)
              event.dataTransfer.effectAllowed = 'move'
            } catch {
              /* ignore */
            }
          },
          onClick: () => (onOpen ? onOpen(session.id) : openSession(ctx, session.id)),
          onContextMenu: (event) => {
            event.preventDefault()
            onMenu(event, session)
          },
        },
        h('span', { className: 'dsc-lead' }, leadingIcon || null),
        h('span', { className: 'dsc-name' }, sessionTitle(session)),
        showTag && workspaceTitle ? h('span', { className: 'dsc-tag' }, workspaceTitle) : null,
        h('span', { className: 'dsc-time' }, relTime(session.updatedAt || session.createdAt)),
      )
    }

    /* ---------------------------- 主组件 ---------------------------- */

    function SidebarCards({ ctx, slotProps }) {
      const propsKeyText = (() => {
        try {
          return Object.keys(slotProps || {}).slice(0, 30).join(', ') || '(none)'
        } catch {
          return '(unreadable)'
        }
      })()
      const state = useSidebarData(ctx)
      const data = state.data

      // 官方插槽自带的数据 hook（优先于 Remote）
      useEffect(() => {
        let alive = true
        ;(async () => {
          try {
            const controller = new AbortController()
            const abortTimer = setTimeout(() => controller.abort(), 3000)
            const response = await fetch('/sidebar-cards/data', { credentials: 'same-origin', signal: controller.signal })
            clearTimeout(abortTimer)
            const text = await response.text()
            if (!alive) return
            state.ingestDiag({ httpTest: response.status + ' len=' + text.length + ' ' + text.slice(0, 50) })
          } catch (error) {
            if (alive) state.ingestDiag({ httpTest: 'ERR:' + String((error && error.message) || error).slice(0, 90) })
          }
        })()
        return () => {
          alive = false
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      useEffect(() => {
        try {
          const names = ['sessions', 'sessionCatalog', 'sessionList', 'sessionStore', 'remote', 'remote.session', 'remote.workspace', 'remote.schedule', 'uiSession']
          const found = []
          for (const name of names) {
            let hit = 'no'
            try {
              hit = ctx.get(name) ? 'yes' : 'undefined'
            } catch (error) {
              hit = 'ERR:' + String((error && error.message) || error).slice(0, 40)
            }
            found.push(name + '=' + hit)
          }
          let remoteKeys = 'no-remote'
          try {
            const remote = ctx.remote
            remoteKeys = remote ? Object.keys(remote).slice(0, 40).join(',') : 'null'
          } catch (error) {
            remoteKeys = 'ERR:' + String((error && error.message) || error).slice(0, 40)
          }
          state.ingestDiag && state.ingestDiag({ ctxKeys: found.join(' | ') + ' || remote: ' + remoteKeys })
        } catch {
          /* ignore */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const hookErrorRef = useRef('')
      const hookRawRef = useRef('')
      let hookSessions = null
      let hookWorkspaces = null
      try {
        if (slotProps && typeof slotProps.useSessions === 'function') hookSessions = slotProps.useSessions((value) => value)
      } catch (error) {
        hookErrorRef.current = 'useSessions: ' + String((error && error.message) || error)
      }
      try {
        if (slotProps && typeof slotProps.useWorkspaces === 'function') hookWorkspaces = slotProps.useWorkspaces((value) => value)
      } catch (error) {
        hookErrorRef.current += (hookErrorRef.current ? ' · ' : '') + 'useWorkspaces: ' + String((error && error.message) || error)
      }
      try {
        if (hookSessions && !hookRawRef.current) {
          const sample = Array.isArray(hookSessions) ? hookSessions.slice(0, 2) : hookSessions
          hookRawRef.current = JSON.stringify(sample).slice(0, 300)
        }
      } catch {
        hookRawRef.current = '(unserializable)'
      }
      useEffect(() => {
        if (hookSessions) state.ingest(hookSessions)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [hookSessions])
      useEffect(() => {
        if (hookWorkspaces) state.ingestWorkspaces(hookWorkspaces)
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [hookWorkspaces])
      const [collapsed, setCollapsed] = useState(() => lsGet('collapsed', { pinned: true, schedule: true }))
      const [recent, setRecent] = useState(() => lsGet('recentWorkspaces', []))
      const [expandedMap, setExpandedMap] = useState({})
      const [view, setView] = useState(() => lsGet('view', 'grouped'))
      const [limits, setLimits] = useState({})
      const [menu, setMenu] = useState(null)
      const [searchOpen, setSearchOpen] = useState(false)
      const [query, setQuery] = useState('')
      const [activeId, setActiveId] = useState('')
      const [activeSessionId, setActiveSessionId] = useState(() => lsGet('activeSessionId', ''))
      const [selectedCardId, setSelectedCardId] = useState(() => lsGet('selectedCard', ''))

      const selectCard = useCallback((cardId) => {
        setSelectedCardId(cardId)
        lsSet('selectedCard', cardId)
      }, [])

      const handleOpen = useCallback(
        (sessionId) => {
          setActiveSessionId(sessionId)
          lsSet('activeSessionId', sessionId)
          openSession(ctx, sessionId)
        },
        [ctx],
      )

      const pluginHostRef = useRef(null)

      useEffect(() => {
        let cancelled = false
        let moved = null
        let originalParent = null
        let originalNext = null
        let movedBot = null
        let botOriginalParent = null
        let botOriginalNext = null
        let tries = 0

        const attach = () => {
          if (cancelled) return
          const host = pluginHostRef.current
          const root = host && host.closest ? host.closest('.dsc-root') : document.querySelector('.dsc-root')
          if (!host || !root) {
            tries += 1
            if (tries < 40) setTimeout(attach, 100)
            return
          }
          let column = root
          while (column && column.parentElement && column.tagName !== 'ASIDE') column = column.parentElement
          const nav = column ? Array.from(column.querySelectorAll('nav')).find((node) => !node.contains(root)) : null
          if (!nav) {
            tries += 1
            if (tries < 40) setTimeout(attach, 100)
            return
          }
          originalParent = nav.parentElement
          originalNext = nav.nextSibling
          host.appendChild(nav)
          moved = nav
          moveBotRow(column, root, host)
        }

        const moveBotRow = (column, root, host) => {
          try {
            const candidates = Array.from(column.querySelectorAll('button, a, [role="button"], div, span'))
            for (const node of candidates) {
              if (root.contains(node)) continue
              if ((node.textContent || '').trim() !== 'DS Bot') continue
              const clickable = node.closest('button, a, [role="button"]') || node
              if (!clickable || root.contains(clickable)) continue
              if (clickable.dataset.dscMoved) continue
              clickable.dataset.dscMoved = '1'
              botOriginalParent = clickable.parentElement
              botOriginalNext = clickable.nextSibling
              host.appendChild(clickable)
              movedBot = clickable
              return
            }
          } catch {
            /* ignore */
          }
        }
        attach()

        return () => {
          cancelled = true
          if (moved && originalParent) {
            try {
              originalParent.insertBefore(moved, originalNext || null)
            } catch {
              /* ignore */
            }
          }
          if (movedBot && botOriginalParent) {
            try {
              botOriginalParent.insertBefore(movedBot, botOriginalNext || null)
              delete movedBot.dataset.dscMoved
            } catch {
              /* ignore */
            }
          }
        }
      }, [])

      // 用户 2026-11-13：卡片左右边界对齐官方「新建会话」按钮（按钮本身在左栏居中，对齐即居中 + 同宽）
      useEffect(() => {
        const center = () => {
          try {
            const rootEl = document.querySelector('.dsc-root')
            if (!rootEl) return
            const rootRect = rootEl.getBoundingClientRect()
            if (!rootRect.width) return
            const scope = rootEl.closest('aside') || document
            let btn = null
            const byClass = scope.querySelector('[class*="newSession"]')
            if (byClass && !rootEl.contains(byClass)) btn = byClass
            if (!btn) {
              for (const node of scope.querySelectorAll('button, a, [role="button"]')) {
                if (rootEl.contains(node)) continue
                const text = (node.textContent || '').trim()
                if (text.indexOf('新会话') === -1) continue
                const rect = node.getBoundingClientRect()
                if (rect.width > 100 && rect.top < rootRect.top) {
                  btn = node
                  break
                }
              }
            }
            if (!btn) return
            const b = btn.getBoundingClientRect()
            if (!b.width) return
            const padLeft = Math.max(0, Math.round(b.left - rootRect.left))
            const padRight = Math.max(0, Math.round(rootRect.right - b.right))
            rootEl.style.paddingLeft = padLeft + 'px'
            rootEl.style.paddingRight = padRight + 'px'
          } catch {
            /* ignore */
          }
        }
        center()
        const timer = setTimeout(center, 600)
        window.addEventListener('resize', center)
        return () => {
          clearTimeout(timer)
          window.removeEventListener('resize', center)
        }
      }, [])

      const toggle = useCallback((key) => {
        setCollapsed((prev) => {
          const next = Object.assign({}, prev, { [key]: !prev[key] })
          lsSet('collapsed', next)
          return next
        })
      }, [])

      const rememberWorkspace = useCallback((workspaceId) => {
        setRecent((prev) => {
          const next = [workspaceId].concat(prev.filter((id) => id !== workspaceId)).slice(0, 6)
          lsSet('recentWorkspaces', next)
          return next
        })
      }, [])

      const closeMenu = useCallback(() => setMenu(null), [])

      const derived = useMemo(() => {
        if (!data) return null
        const sessions = data.sessions || {}
        const workspaces = (data.workspaces || []).slice()
        const pins = data.pinned || []
        const archived = new Set(data.archived || [])
        const memberIds = new Set()
        for (const workspace of workspaces) for (const id of workspace.sessionIds || []) memberIds.add(id)

        const workspaceById = {}
        for (const workspace of workspaces) workspaceById[workspace.id] = workspace

        const sessionList = Object.keys(sessions).map((id) => sessions[id])
        const weekly = sessionList
          .map((session) => (session.createdAt ? session : Object.assign({}, session, { createdAt: session.updatedAt })))
          .filter((session) => !session.blank && !session.archived && session.createdAt && Date.now() - session.createdAt <= WEEK_MS)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        const pinnedSessions = pins.map((id) => sessions[id]).filter(Boolean)

        const taskSessions = []
        const seen = new Set()
        for (const task of data.tasks || []) {
          for (const id of task.sessionIds || []) {
            if (seen.has(id) || archived.has(id)) continue
            seen.add(id)
            const session = sessions[id]
            if (session && !session.blank) taskSessions.push(session)
          }
        }
        taskSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))

        return { sessions, workspaces, workspaceById, memberIds, weekly, pinnedSessions, taskSessions, archived }
      }, [data])

      const openMenu = useCallback(
        (event, session) => {
          const items = []
          if (session.pinned) items.push({ label: '取消置顶', onSelect: () => act(ctx, 'unpin', session.id).then(() => state.refetch()) })
          else items.push({ label: '置顶会话', onSelect: () => act(ctx, 'pin', session.id).then(() => state.refetch()) })
          if (session.archived) items.push({ label: '取消归档', onSelect: () => act(ctx, 'unarchive', session.id).then(() => state.refetch()) })
          else items.push({ label: '归档会话', danger: true, onSelect: () => act(ctx, 'archive', session.id).then(() => state.refetch()) })
          items.push({
            label: '复制会话 ID',
            onSelect: () => {
              try {
                navigator.clipboard.writeText(session.id)
              } catch {
                /* ignore */
              }
            },
          })
          const rect = event.currentTarget.getBoundingClientRect()
          const width = 148
          setMenu({
            x: Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8),
            y: Math.min(rect.bottom + 4, window.innerHeight - 150),
            items,
          })
        },
        [ctx, state],
      )

      const filterSession = useCallback(
        (session) => {
          if (!query.trim()) return true
          const q = query.trim().toLowerCase()
          return ((session.title || '') + ' ' + (session.cwd || '')).toLowerCase().includes(q)
        },
        [query],
      )

      const selectedCard = useMemo(() => {
        if (!derived) return ''
        if (selectedCardId) return selectedCardId
        if (!activeSessionId) return ''
        if (derived.weekly.some((session) => session.id === activeSessionId)) return 'weekly'
        if (derived.pinnedSessions.some((session) => session.id === activeSessionId)) return 'pinned'
        if (derived.taskSessions.some((session) => session.id === activeSessionId)) return 'schedule'
        if (derived.workspaces.some((workspace) => (workspace.sessionIds || []).includes(activeSessionId))) return 'workspaces'
        return ''
      }, [derived, activeSessionId, selectedCardId])

      const handleRowOpen = useCallback(
        (sessionId) => {
          handleOpen(sessionId)
          if (!derived) return
          if (derived.weekly.some((session) => session.id === sessionId)) selectCard('weekly')
          else if (derived.pinnedSessions.some((session) => session.id === sessionId)) selectCard('pinned')
          else if (derived.taskSessions.some((session) => session.id === sessionId)) selectCard('schedule')
          else if (derived.workspaces.some((workspace) => (workspace.sessionIds || []).includes(sessionId))) selectCard('workspaces')
        },
        [derived, handleOpen, selectCard],
      )

      const weeklyGroups = useMemo(() => {
        if (!derived) return []
        const groups = []
        let current = null
        for (const session of derived.weekly) {
          if (!filterSession(session)) continue
          const bucket = dayBucket(session.createdAt)
          if (!current || current.label !== bucket) {
            current = { label: bucket, items: [] }
            groups.push(current)
          }
          current.items.push(session)
        }
        return groups
      }, [derived, filterSession])

      const pinnedList = useMemo(() => (derived ? derived.pinnedSessions.filter((s) => !s.blank).filter(filterSession) : []), [derived, filterSession])
      const taskList = useMemo(() => (derived ? derived.taskSessions.filter(filterSession) : []), [derived, filterSession])

      const openViewMenu = useCallback(
        (event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({
            x: Math.max(8, rect.right - 160),
            y: rect.bottom + 4,
            items: [
              { label: '分组视图' + (view === 'grouped' ? ' ✓' : ''), onSelect: () => { setView('grouped'); lsSet('view', 'grouped') } },
              { label: '平铺视图' + (view === 'flat' ? ' ✓' : ''), onSelect: () => { setView('flat'); lsSet('view', 'flat') } },
              { label: '显示归档会话' + (view === 'withArchived' ? ' ✓' : ''), onSelect: () => { setView('withArchived'); lsSet('view', 'withArchived') } },
            ],
          })
        },
        [view],
      )

      const headerActions = useMemo(
        () => [
          h(
            'span',
            {
              key: 's',
              className: 'dsc-hact',
              title: '搜索会话',
              onClick: (event) => {
                event.stopPropagation()
                setSearchOpen((prev) => {
                  const next = !prev
                  if (next) {
                    setCollapsed((prevCollapsed) => {
                      const merged = Object.assign({}, prevCollapsed, { workspaces: false })
                      lsSet('collapsed', merged)
                      return merged
                    })
                  }
                  return next
                })
              },
            },
            h(IcoSearch),
          ),
          h('span', { key: 'v', className: 'dsc-hact', title: '视图选项', onClick: (event) => { event.stopPropagation(); openViewMenu(event) } }, h(IcoList)),
          h(
            'span',
            {
              key: 'a',
              className: 'dsc-hact',
              title: '新建工作区',
              onClick: async (event) => {
                event.stopPropagation()
                try {
                  const ui = (ctx.get && ctx.get('uiWorkspace')) || ctx.uiWorkspace
                  const registry = (ctx.get && ctx.get('workspaces')) || ctx.workspaces
                  const dir = ui && ui.pickDirectory ? await ui.pickDirectory() : null
                  if (dir && registry && registry.create) await registry.create({ path: dir })
                  state.refetch()
                } catch {
                  /* ignore */
                }
              },
            },
            h(IcoPlus),
          ),
        ],
        [ctx, openViewMenu, state],
      )

      if (!derived) {
        const caps = ['session', 'workspace', 'schedule']
          .map((key) => {
            const ns = remoteNamespace(ctx, key)
            if (!ns) return key + ':no'
            const usable = typeof ns.list === 'function' || typeof ns.follow === 'function'
            return key + ':' + (usable ? 'ok' : 'obj')
          })
          .join(' · ')
        if (state.status === 'loading') {
          // 加载中保持空白（只放极轻的骨架），避免闪出一段临时文字
          return h('div', { className: 'dsc-root' }, h('style', null, STYLE_TEXT), h('div', { className: 'dsc-skeleton' }))
        }
        return h(
          'div',
          { className: 'dsc-root' },
          h('style', null, STYLE_TEXT),
          h(
            'div',
            { className: 'dsc-status' },
            '数据加载失败：' + (state.error || '未知错误'),
            h('div', { style: { marginTop: 4, fontSize: 11, color: '#aaa' } }, caps),
            h('button', { onClick: () => state.refetch() }, '重试'),
          ),
        )
      }

      const showArchived = view === 'withArchived'

      function cardHead(key, title, options) {
        const opts = options || {}
        const isCollapsed = !!collapsed[key]
        return h(
          'div',
          {
            className: 'dsc-head',
            role: 'button',
            'aria-expanded': String(!isCollapsed),
            style: opts.selected ? HEAD_SELECTED : HEAD_GLASS,
            onClick: () => {
              selectCard(key)
              toggle(key)
            },
          },
          h('span', { className: 'dsc-title' }, title),
          opts.count != null ? h('span', { className: 'dsc-count' }, String(opts.count)) : null,
          opts.actions ? h('span', { className: 'dsc-hacts' }, opts.actions) : null,
          h('span', { className: 'dsc-arrow', style: opts.actions ? { marginLeft: 7 } : null }, isCollapsed ? h(ChevronRight) : h(ChevronDown)),
        )
      }

      function searchBar() {
        return h(
          'div',
          { className: 'dsc-search' },
          h(IcoSearch, { width: 13, height: 13 }),
          h('input', {
            autoFocus: true,
            placeholder: '搜索会话标题 / 目录（回车生效）',
            value: query,
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                setQuery('')
                setSearchOpen(false)
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                setQuery((prev) => prev + '')
              }
            },
          }),
          query.trim()
            ? h(
                'span',
                { style: { fontSize: 11, color: '#9a9a9a', whiteSpace: 'nowrap' } },
                weeklyGroups.reduce((sum, group) => sum + group.items.length, 0) + pinnedList.length + taskList.length + ' 条',
              )
            : null,
        )
      }

      function panelRow(label, icon) {
        return h(
          'div',
          { key: label, className: 'dsc-prow', onClick: () => selectPanel(ctx, label) },
          h('span', { className: 'dsc-lead', style: { color: '#5d5d5d' } }, icon),
          label,
        )
      }

      const cards = []

      cards.push(
        h(
          'section',
          { key: 'plugins', className: 'dsc-card' + (collapsed.plugins ? ' dsc-collapsed' : '') },
          cardHead('plugins', '插件'),
          h('div', { className: 'dsc-body', style: collapsed.plugins ? { display: 'none' } : null }, h('div', { className: 'dsc-panel-host', ref: pluginHostRef })),
        ),
      )

      if (weeklyGroups.length) {
        const total = weeklyGroups.reduce((sum, group) => sum + group.items.length, 0)
        cards.push(
          h(
            'section',
            { key: 'weekly', className: 'dsc-card' + (collapsed.weekly ? ' dsc-collapsed' : '') },
            cardHead('weekly', '一周会话', { count: total, selected: selectedCard === 'weekly' }),
            collapsed.weekly
              ? null
              : h(
                  'div',
                  { className: 'dsc-body' },
                  weeklyGroups.map((group) =>
                    h(
                      'div',
                      { key: group.label },
                      h('div', { className: 'dsc-day' }, group.label),
                      group.items.map((session) =>
                        h(SessionRow, {
                          key: session.id,
                          ctx,
                          session,
                          activeId,
                          onMenu: openMenu, onOpen: handleRowOpen,
                          showTag: false,
                          workspaceTitle: (derived.workspaces.find((workspace) => (workspace.sessionIds || []).includes(session.id)) || {}).title,
                        }),
                      ),
                    ),
                  ),
                ),
          ),
        )
      }

      if (pinnedList.length) {
        const limit = limits.pinned || 10
        cards.push(
          h(
            'section',
            { key: 'pinned', className: 'dsc-card' + (collapsed.pinned ? ' dsc-collapsed' : '') },
            cardHead('pinned', '置顶会话', { count: pinnedList.length, selected: selectedCard === 'pinned' }),
            collapsed.pinned
              ? null
              : h(
                  'div',
                  { className: 'dsc-body' },
                  pinnedList.slice(0, limit).map((session) =>
                    h(SessionRow, {
                      key: session.id,
                      ctx,
                      session,
                      activeId,
                      onMenu: openMenu, onOpen: handleRowOpen,
                      showTag: false,
                      workspaceTitle: (derived.workspaces.find((workspace) => (workspace.sessionIds || []).includes(session.id)) || {}).title,
                    }),
                  ),
                  pinnedList.length > limit
                    ? h('div', { className: 'dsc-more', onClick: () => setLimits((prev) => Object.assign({}, prev, { pinned: limit + 10 })) }, '显示更多')
                    : null,
                ),
          ),
        )
      }

      if (taskList.length) {
        const limit = limits.schedule || 10
        cards.push(
          h(
            'section',
            { key: 'schedule', className: 'dsc-card' + (collapsed.schedule ? ' dsc-collapsed' : '') },
            cardHead('schedule', '自动化任务会话', { count: taskList.length, selected: selectedCard === 'schedule' }),
            collapsed.schedule
              ? null
              : h(
                  'div',
                  { className: 'dsc-body' },
                  taskList.slice(0, limit).map((session) =>
                    h(SessionRow, {
                      key: session.id,
                      ctx,
                      session,
                      activeId,
                      onMenu: openMenu, onOpen: handleRowOpen,
                      showTag: false,
                      workspaceTitle: (derived.workspaces.find((workspace) => (workspace.sessionIds || []).includes(session.id)) || {}).title,
                    }),
                  ),
                  taskList.length > limit
                    ? h('div', { className: 'dsc-more', onClick: () => setLimits((prev) => Object.assign({}, prev, { schedule: limit + 10 })) }, '显示更多')
                    : null,
                ),
          ),
        )
      }

      const workspaceRows = []
      const defaultExpanded = recent.length ? recent.slice(0, 2) : derived.workspaces.slice(0, 2).map((workspace) => workspace.id)
      for (const workspace of derived.workspaces) {
        const sessions = (workspace.sessionIds || [])
          .map((id) => derived.sessions[id])
          .filter(Boolean)
          .filter((session) => !session.blank)
          .filter((session) => showArchived || !session.archived)
          .filter(filterSession)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        const expanded = expandedMap[workspace.id] !== undefined ? expandedMap[workspace.id] : defaultExpanded.indexOf(workspace.id) !== -1
        const limit = limits[workspace.id] || 15
        workspaceRows.push(
          h(
            'div',
            { key: workspace.id },
            h(
              'div',
              {
                className: 'dsc-ws',
                onClick: () => {
                  const nextRecent = [workspace.id].concat(recent.filter((id) => id !== workspace.id)).slice(0, 2)
                  rememberWorkspace(workspace.id)
                  setExpandedMap((prev) => {
                    if (expanded) {
                      return Object.assign({}, prev, { [workspace.id]: false })
                    }
                    const next = {}
                    for (const workspaceItem of derived.workspaces) next[workspaceItem.id] = nextRecent.indexOf(workspaceItem.id) !== -1
                    return Object.assign({}, prev, next, { [workspace.id]: true })
                  })
                },
              },
              h('span', { className: 'dsc-lead' }, h(IcoFolder)),
              h('span', { className: 'dsc-wn' }, workspace.title || workspace.path || '未命名工作区'),
              h('span', { className: 'dsc-wc' }, String(sessions.length)),
              h(
                'span',
                { className: 'dsc-ws-actions' },
                h(
                  'span',
                  {
                    className: 'dsc-hact',
                    title: '新建会话',
                    onClick: (event) => {
                      event.stopPropagation()
                      startSession(ctx, workspace.id)
                    },
                  },
                  h(IcoPlus),
                ),
              ),
              h('span', { className: 'dsc-arrow' }, expanded ? h(ChevronDown) : h(ChevronRight)),
            ),
            expanded
              ? h(
                  'div',
                  {
                    className: 'dsc-ws-body',
                    onDragOver: (event) => {
                      event.preventDefault()
                      try {
                        event.dataTransfer.dropEffect = 'move'
                      } catch {
                        /* ignore */
                      }
                    },
                    onDrop: (event) => {
                      event.preventDefault()
                      const dragged = event.dataTransfer.getData('text/dsh-session')
                      if (!dragged) return
                      const rowEl = event.target && event.target.closest ? event.target.closest('[data-session-id]') : null
                      const beforeId = rowEl ? rowEl.getAttribute('data-session-id') : null
                      if (!beforeId || beforeId === dragged) return
                      try {
                        const registry = (ctx.get && ctx.get('workspaces')) || ctx.workspaces
                        const pending = registry && registry.insertSessionBefore ? registry.insertSessionBefore(workspace.id, dragged, beforeId) : null
                        Promise.resolve(pending).then(() => state.refetch()).catch(() => {})
                      } catch {
                        /* ignore */
                      }
                    },
                  },
                  sessions.slice(0, limit).map((session) =>
                    h(SessionRow, { key: session.id, ctx, session, activeId, onMenu: openMenu, onOpen: handleRowOpen, showTag: false }),
                  ),
                  sessions.length > limit
                    ? h(
                        'div',
                        { className: 'dsc-more', onClick: () => setLimits((prev) => Object.assign({}, prev, { [workspace.id]: limit + 15 })) },
                        '显示更多（还有 ' + (sessions.length - limit) + ' 条）',
                      )
                    : null,
                )
              : null,
          ),
        )
      }

      if (view !== 'flat' && workspaceRows.length) {
        cards.push(
          h(
            'section',
            { key: 'workspaces', className: 'dsc-card' + (collapsed.workspaces ? ' dsc-collapsed' : '') },
            cardHead('workspaces', '工作区', { actions: headerActions, selected: selectedCard === 'workspaces' }),
            collapsed.workspaces ? null : h('div', { className: 'dsc-body' }, searchOpen ? searchBar() : null, workspaceRows),
          ),
        )
      }

      if (view === 'flat') {
        const all = Object.keys(derived.sessions)
          .map((id) => derived.sessions[id])
          .filter((session) => !session.blank)
          .filter((session) => showArchived || !session.archived)
          .filter(filterSession)
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
        const limit = limits.flat || 40
        cards.push(
          h(
            'section',
            { key: 'flat', className: 'dsc-card' },
            cardHead('flat', '全部会话', { count: all.length, actions: headerActions, selected: selectedCard === 'workspaces' }),
            h(
              'div',
              { className: 'dsc-body' },
              searchOpen ? searchBar() : null,
              all.slice(0, limit).map((session) =>
                h(SessionRow, {
                  key: session.id,
                  ctx,
                  session,
                  activeId,
                  onMenu: openMenu, onOpen: handleRowOpen,
                  showTag: true,
                  workspaceTitle: (derived.workspaces.find((workspace) => (workspace.sessionIds || []).includes(session.id)) || {}).title,
                }),
              ),
              all.length > limit ? h('div', { className: 'dsc-more', onClick: () => setLimits((prev) => Object.assign({}, prev, { flat: limit + 40 })) }, '显示更多') : null,
            ),
          ),
        )
      }

      const sessionIds = Object.keys(derived.sessions)
      if (!sessionIds.length && state.status === 'error') {
        const diag = (data && data.diag) || {}
        const lines = [
          '会话：' + (diag.session || '未返回'),
          '工作区：' + (diag.workspace || '未返回'),
          '自动化：' + (diag.schedule || '未返回'),
          'HTTP 兜底：' + (diag.http || '未触发'),
          '插槽 props：' + (propsKeyText || '-'),
          'useSessions：' + (hookErrorRef.current || (hookSessions ? 'ok' : 'absent')),
          'hook 原始：' + (hookRawRef.current || '-'),
          'search：' + ((data.diag && data.diag.search) || '-') + ' · 原始：' + ((data.diag && data.diag.searchRaw) || '-'),
          'ctx 服务：' + ((data.diag && data.diag.ctxKeys) || '-'),
          'HTTP 测试：' + ((data.diag && data.diag.httpTest) || '-'),
          '行原始：' + ((data.diag && data.diag.rowRaw) || '-'),
          '最近动作：' + (() => {
            try {
              return window.__DSC_LAST || '-'
            } catch {
              return '-'
            }
          })(),
          'session 原始：' + (diag.sessionRaw || '-'),
          'frame 原始：' + (diag.frameRaw || '-'),
        ]
        cards.unshift(
          h(
            'section',
            { key: 'diag', className: 'dsc-card' },
            h('div', { className: 'dsc-head' }, h('span', { className: 'dsc-title' }, '诊断（临时）')),
            h(
              'div',
              { className: 'dsc-body' },
              lines.map((line, index) =>
                h('div', { key: index, className: 'dsc-status', style: { padding: '2px 8px', fontSize: 11, lineHeight: '18px' } }, line),
              ),
              h('div', { className: 'dsc-more', onClick: () => state.refetch() }, '重新拉取'),
            ),
          ),
        )
      }

      return h(
        'div',
        { className: 'dsc-root' },
        h('style', null, STYLE_TEXT),
        h('div', { className: 'dsc-top-space' }),
        cards,
        h(Menu, { state: menu, onClose: closeMenu }),
      )
    }

    /* ---------------------------- 兜底 ---------------------------- */

    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      render() {
        if (this.state.error) {
          return h('div', { className: 'dsc-root' }, h('div', { className: 'dsc-status' }, '侧栏卡片插件出错：' + String((this.state.error && this.state.error.message) || this.state.error)))
        }
        return this.props.children
      }
    }

    return {
      inject: ['slots', 'remote.session', 'remote.workspace', 'remote.schedule'],
      apply(ctx) {
        try {
          const probe = {}
          for (const name of ['remote', 'remote.session', 'remote.workspace', 'remote.schedule']) {
            try {
              probe[name] = !!ctx.get(name)
            } catch (error) {
              probe[name] = 'ERR ' + String((error && error.message) || error)
            }
          }
          console.info('[sidebar-cards] remote probe', probe)
        } catch {
          /* ignore */
        }
        ctx.slots.inject('sidebar.workspaces', () =>
          ctx.slots.register({ name: 'sidebar.workspaces', id: 'dsh-sidebar-cards' }, (slotProps) =>
            h(Boundary, null, h(SidebarCards, { ctx, slotProps }))),
        )
      },
    }
  },
})
