import { useState, useEffect, useCallback } from "react";

// ── Supabase Config ───────────────────────────────────────────────────────────
const SUPABASE_URL = "https://xvnkvdyamrqiialxunmy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh2bmt2ZHlhbXJxaWlhbHh1bm15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MTg4NzYsImV4cCI6MjA5NjA5NDg3Nn0.agl6CVdTDZc6KALdxOD7luh1Nl3Ri3EBzQPnMMdD3Yg";

// ── Auth helpers ──────────────────────────────────────────────────────────────
const auth = {
  async signIn(email, password) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || "Login failed");
    return data;
  },
  async signOut(token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    });
  },
  async getUser(token) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  },
};

// ── DB helpers ────────────────────────────────────────────────────────────────
const makeDb = (token) => ({
  async get(table, params = "") {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`GET ${table} failed: ${res.status}`);
    return res.json();
  },
  async post(table, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${table} failed: ${res.status}`);
    return res.json();
  },
  async patch(table, id, body) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PATCH ${table} failed: ${res.status}`);
    return res.json();
  },
});

// Kiosk db uses anon key (no login needed for clock in/out)
const kioskDb = makeDb(SUPABASE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().split("T")[0];
const fmt = h => h == null ? "—" : `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`;
const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const initials = name => name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
const timeStr = () => { const n = new Date(); return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`; };

// Detect kiosk mode from URL: /kiosk or /kiosk/siteid
const getKioskSiteId = () => {
  const path = window.location.pathname;
  if (!path.startsWith("/kiosk")) return null;
  const parts = path.split("/");
  if (parts[2]) return parseInt(parts[2]);
  return 0; // 0 = kiosk but no site selected yet
};

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const kioskSiteId = getKioskSiteId();
  if (kioskSiteId !== null) return <KioskApp siteId={kioskSiteId === 0 ? null : kioskSiteId} />;
  return <AuthGate />;
}

// ── Auth Gate ─────────────────────────────────────────────────────────────────
function AuthGate() {
  const [session, setSession] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pharma_session")); } catch { return null; }
  });
  const [userMeta, setUserMeta] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pharma_user")); } catch { return null; }
  });

  const handleLogin = (sess, meta) => {
    localStorage.setItem("pharma_session", JSON.stringify(sess));
    localStorage.setItem("pharma_user", JSON.stringify(meta));
    setSession(sess);
    setUserMeta(meta);
  };

  const handleLogout = async () => {
    if (session?.access_token) await auth.signOut(session.access_token).catch(() => {});
    localStorage.removeItem("pharma_session");
    localStorage.removeItem("pharma_user");
    setSession(null);
    setUserMeta(null);
  };

  if (!session) return <LoginScreen onLogin={handleLogin} />;
  return <MainApp token={session.access_token} userMeta={userMeta} onLogout={handleLogout} />;
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const handleSubmit = async () => {
    if (!email || !password) { setError("Please enter your email and password"); return; }
    setLoading(true); setError("");
    try {
      const sess = await auth.signIn(email, password);
      // Get user metadata to check role/site
      const user = await auth.getUser(sess.access_token);
      onLogin(sess, user?.user_metadata || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={LS.root}>
      <style>{loginCss}</style>
      <div style={LS.left}>
        <div style={LS.leftInner}>
          <div style={LS.bigTime}>{time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</div>
          <div style={LS.bigDate}>{time.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <div style={LS.tagline}>Time & Attendance<br />for the Roshban Group</div>
          <div style={LS.sites}>42 sites · 144 staff</div>
        </div>
      </div>
      <div style={LS.right}>
        <div style={LS.form}>
          <div style={LS.logoRow}>
            <span style={LS.logoIcon}>Rx</span>
            <div>
              <div style={LS.logoName}>PharmaClock</div>
              <div style={LS.logoSub}>Roshban Group</div>
            </div>
          </div>
          <div style={LS.formTitle}>Welcome back</div>
          <div style={LS.formSub}>Sign in to your account</div>
          {error && <div style={LS.error}>{error}</div>}
          <div style={LS.field}>
            <label style={LS.label}>Email</label>
            <input style={LS.input} type="email" placeholder="you@roshban.co.uk"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>
          <div style={LS.field}>
            <label style={LS.label}>Password</label>
            <input style={LS.input} type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSubmit()} />
          </div>
          <button style={LS.btn} className="login-btn" onClick={handleSubmit} disabled={loading}>
            {loading ? "Signing in…" : "Sign In →"}
          </button>
          <div style={LS.kioskNote}>
            Staff clock-in terminal? Use the <span style={{ color: "#4da6ff", cursor: "pointer" }}
              onClick={() => window.location.href = "/kiosk"}>/kiosk</span> page
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Kiosk App (no login, PIN only) ────────────────────────────────────────────
function KioskApp({ siteId: initialSiteId }) {
  const [sites, setSites] = useState([]);
  const [staff, setStaff] = useState([]);
  const [selectedSite, setSelectedSite] = useState(initialSiteId);
  const [clockedIn, setClockedIn] = useState({});
  const [pinEntry, setPinEntry] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinAction, setPinAction] = useState("in");
  const [notification, setNotification] = useState(null);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    kioskDb.get("sites", "?order=name").then(setSites).catch(console.error);
    kioskDb.get("staff", "?active=eq.true&order=name").then(setStaff).catch(console.error);
  }, []);

  const notify = (msg, type = "success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
  };

  const submitPin = async () => {
    const member = staff.find(s =>
      s.pin === pinEntry && (selectedSite == null || s.site_id === selectedSite)
    );
    if (!member) { setPinError("PIN not recognised"); return; }
    const now = timeStr();
    const date = todayStr();
    try {
      if (pinAction === "in") {
        if (clockedIn[member.id]) { setPinError(`${member.name} is already clocked in`); return; }
        const [rec] = await kioskDb.post("attendance", {
          staff_id: member.id, site_id: member.site_id,
          date, clock_in: now, break_minutes: 30, approved: false,
        });
        setClockedIn(p => ({ ...p, [member.id]: { time: now, attendanceId: rec.id } }));
        notify(`✓ ${member.name} clocked IN at ${now}`);
      } else {
        if (!clockedIn[member.id]) { setPinError(`${member.name} is not clocked in`); return; }
        const inData = clockedIn[member.id];
        const [inH, inM] = inData.time.split(":").map(Number);
        const [outH, outM] = now.split(":").map(Number);
        const gross = parseFloat(((outH + outM / 60) - (inH + inM / 60)).toFixed(2));
        const net = parseFloat((gross - 0.5).toFixed(2));
        await kioskDb.patch("attendance", inData.attendanceId, { clock_out: now, gross_hours: gross, net_hours: net });
        setClockedIn(p => { const n = { ...p }; delete n[member.id]; return n; });
        notify(`✓ ${member.name} clocked OUT — ${fmt(net)} worked`);
      }
      setPinEntry("");
      setPinError("");
    } catch (e) {
      setPinError("Error — please try again");
    }
  };

  const site = sites.find(s => s.id === selectedSite);

  return (
    <div style={KS.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        .kpin-btn:hover { background: #2a2a3a !important; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
      `}</style>

      {notification && (
        <div style={{ ...KS.notif, background: notification.type === "success" ? "#00c896" : "#ff4d4d" }}>
          {notification.msg}
        </div>
      )}

      <div style={KS.header}>
        <div style={KS.logo}><span style={KS.logoIcon}>Rx</span> PharmaClock</div>
        {site && <div style={KS.siteName}>{site.name}</div>}
        <div style={KS.clock}>{time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
      </div>

      <div style={KS.body}>
        {!selectedSite && (
          <div style={KS.siteSelect}>
            <div style={KS.selectTitle}>Select your site</div>
            <div style={KS.siteGrid}>
              {sites.filter(s => staff.some(x => x.site_id === s.id)).map(s => (
                <div key={s.id} style={KS.siteBtn} className="kpin-btn" onClick={() => setSelectedSite(s.id)}>
                  {s.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedSite && (
          <div style={KS.pinArea}>
            <div style={KS.date}>{time.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</div>

            <div style={KS.toggleRow}>
              <button style={{ ...KS.toggleBtn, ...(pinAction === "in" ? KS.toggleActive : {}) }} onClick={() => { setPinAction("in"); setPinEntry(""); setPinError(""); }}>
                ▶ Clock In
              </button>
              <button style={{ ...KS.toggleBtn, ...(pinAction === "out" ? KS.toggleActiveOut : {}) }} onClick={() => { setPinAction("out"); setPinEntry(""); setPinError(""); }}>
                ■ Clock Out
              </button>
            </div>

            <div style={KS.pinDisplay}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} style={{ ...KS.pinDot, background: i < pinEntry.length ? (pinAction === "in" ? "#00c896" : "#ff6b6b") : "transparent" }} />
              ))}
            </div>

            {pinError && <div style={KS.pinError}>{pinError}</div>}
            {!pinError && <div style={KS.pinHint}>Enter your 4-digit PIN</div>}

            <div style={KS.pinGrid}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, "←", 0, "✓"].map(k => (
                <button key={k} style={{ ...KS.pinBtn, ...(k === "✓" ? { background: pinAction === "in" ? "#00c896" : "#ff6b6b", color: "#0d0d14", fontWeight: 800 } : {}) }}
                  className="kpin-btn" onClick={() => {
                    if (k === "←") { setPinEntry(p => p.slice(0, -1)); setPinError(""); }
                    else if (k === "✓") submitPin();
                    else if (pinEntry.length < 4) { setPinEntry(p => p + k); setPinError(""); }
                  }}>{k}</button>
              ))}
            </div>

            {Object.keys(clockedIn).length > 0 && (
              <div style={KS.liveList}>
                <div style={KS.liveTitle}>Currently clocked in</div>
                {Object.entries(clockedIn).slice(0, 5).map(([id, data]) => {
                  const s = staff.find(x => x.id === parseInt(id));
                  if (!s) return null;
                  return (
                    <div key={id} style={KS.liveRow}>
                      <div style={KS.liveAvatar}>{initials(s.name)}</div>
                      <div style={KS.liveName}>{s.name}</div>
                      <div style={KS.liveTime}>since {data.time}</div>
                    </div>
                  );
                })}
              </div>
            )}

            <button style={KS.changeSite} onClick={() => setSelectedSite(null)}>Change site</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main App (logged in) ──────────────────────────────────────────────────────
function MainApp({ token, userMeta, onLogout }) {
  const db = makeDb(token);
  const [view, setView] = useState("dashboard");
  const [sites, setSites] = useState([]);
  const [staff, setStaff] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [clockedIn, setClockedIn] = useState({});
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState(null);
  const [selectedSite, setSelectedSite] = useState(
    userMeta?.site_id ? parseInt(userMeta.site_id) : null
  );
  const isAdmin = !userMeta?.site_id;
  const [staffFilter, setStaffFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState(userMeta?.site_id ? String(userMeta.site_id) : "all");
  const [approveMode, setApproveMode] = useState(false);
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true); setDbError(null);
    try {
      const siteParam = userMeta?.site_id ? `?id=eq.${userMeta.site_id}` : "?order=name";
      const staffParam = userMeta?.site_id ? `?site_id=eq.${userMeta.site_id}&active=eq.true&order=name` : "?active=eq.true&order=name";
      const [sitesData, staffData, attData] = await Promise.all([
        db.get("sites", siteParam),
        db.get("staff", staffParam),
        db.get("attendance", `?date=gte.${new Date(Date.now()-7*86400000).toISOString().split("T")[0]}&order=date.desc`),
      ]);
      setSites(sitesData);
      setStaff(staffData);
      setAttendance(attData);
      const open = attData.filter(r => r.date === todayStr() && !r.clock_out);
      const ci = {};
      open.forEach(r => { ci[r.staff_id] = { time: r.clock_in?.slice(0,5), attendanceId: r.id }; });
      setClockedIn(ci);
    } catch (e) { setDbError(e.message); }
    finally { setLoading(false); }
  }, [token, userMeta?.site_id]);

  useEffect(() => { loadData(); }, [loadData]);

  const notify = (msg, type = "success") => {
    // simple inline notification
    console.log(msg);
  };

  const approveRecord = async (recId) => {
    try {
      const [updated] = await db.patch("attendance", recId, { approved: true, approved_at: new Date().toISOString() });
      setAttendance(p => p.map(r => r.id === recId ? updated : r));
    } catch (e) { alert("Approval failed"); }
  };

  const exportCSV = () => {
    const filteredAtt = selectedSite != null ? attendance.filter(r => r.site_id === selectedSite) : attendance;
    const rows = [["Employee","Role","Site","Date","Clock In","Clock Out","Gross Hours","Break (mins)","Net Hours","Approved"]];
    filteredAtt.forEach(r => {
      const s = staff.find(x => x.id === r.staff_id);
      const site = sites.find(x => x.id === r.site_id);
      if (!s) return;
      rows.push([s.name, s.role||"", site?.name||"", r.date, r.clock_in?.slice(0,5)||"", r.clock_out?.slice(0,5)||"", r.gross_hours||"", r.break_minutes||30, r.net_hours||"", r.approved?"Yes":"No"]);
    });
    const csv = rows.map(r=>r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download = `attendance_${todayStr()}.csv`;
    a.click();
  };

  const totalClockedIn = Object.keys(clockedIn).length;
  const todayRecs = attendance.filter(r => r.date === todayStr() && r.clock_out);
  const pendingApprovals = attendance.filter(r => !r.approved && r.clock_out).length;
  const weekHours = attendance.reduce((sum,r) => sum+(r.net_hours||0), 0);

  const filteredStaff = staff.filter(s => {
    const matchSite = siteFilter==="all" || s.site_id===parseInt(siteFilter);
    const matchName = s.name.toLowerCase().includes(staffFilter.toLowerCase()) || (s.role||"").toLowerCase().includes(staffFilter.toLowerCase());
    return matchSite && matchName;
  });

  const navItems = [
    {id:"dashboard",label:"Dashboard",icon:"⬡"},
    {id:"clock",label:"Clock In/Out",icon:"◎"},
    {id:"staff",label:"Staff",icon:"◈"},
    {id:"timesheets",label:"Timesheets",icon:"▦"},
    ...(isAdmin ? [{id:"sites",label:"Sites",icon:"◉"}] : []),
    {id:"reports",label:"Reports",icon:"▤"},
    ...(isAdmin ? [{id:"pins",label:"Manage PINs",icon:"◆"}] : []),
  ];

  if (loading) return (
    <div style={{...S.root,alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={S.spinner}/>
      <div style={{color:"#555570",fontSize:13}}>Loading…</div>
    </div>
  );

  if (dbError) return (
    <div style={{...S.root,alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,padding:40}}>
      <div style={{color:"#ff6b6b",fontWeight:700,fontSize:16}}>Connection error</div>
      <div style={{color:"#555570",fontSize:13}}>{dbError}</div>
      <button style={S.exportBtn} onClick={loadData}>Retry</button>
      <button style={{...S.exportBtn,background:"transparent",color:"#555570",border:"1px solid #2a2a3a"}} onClick={onLogout}>Sign Out</button>
    </div>
  );

  return (
    <div style={S.root}>
      <style>{css}</style>
      <aside style={S.sidebar}>
        <div style={S.logo}>
          <span style={S.logoIcon}>Rx</span>
          <div>
            <div style={S.logoName}>PharmaClock</div>
            <div style={S.logoSub}>{isAdmin ? "Admin" : sites[0]?.name || "Manager"}</div>
          </div>
        </div>
        <nav style={S.nav}>
          {navItems.map(n => (
            <button key={n.id} style={{...S.navItem,...(view===n.id?S.navActive:{})}} className="nav-item" onClick={()=>setView(n.id)}>
              <span style={S.navIcon}>{n.icon}</span>{n.label}
              {n.id==="timesheets"&&pendingApprovals>0&&<span style={S.badge}>{pendingApprovals}</span>}
            </button>
          ))}
        </nav>
        <div style={S.sidebarBottom}>
          <div style={S.sidebarStat}><span style={S.sidebarStatNum}>{totalClockedIn}</span> clocked in now</div>
          <div style={S.sidebarStat}><span style={S.sidebarStatNum}>{staff.length}</span> staff</div>
          {isAdmin && <div style={S.sidebarStat}><span style={S.sidebarStatNum}>{sites.length}</span> sites</div>}
          <div style={{marginTop:8,cursor:"pointer",color:"#4da6ff",fontSize:11}} onClick={loadData}>↻ Refresh</div>
          <div style={{marginTop:6,cursor:"pointer",color:"#555570",fontSize:11}} onClick={onLogout}>Sign out</div>
        </div>
      </aside>

      <main style={S.main}>
        <div style={S.header}>
          <div>
            <div style={S.headerTitle}>{{dashboard:"Overview",clock:"Clock In / Out",staff:"Staff Directory",timesheets:"Timesheets",sites:"Sites",reports:"Reports & Export"}[view]}</div>
            <div style={S.headerDate}>{time.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · {time.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}</div>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            {isAdmin && (
              <button style={{...S.exportBtn,background:"#1a1a2e",color:"#4da6ff",border:"1px solid #2a2a3a"}}
                onClick={() => window.open("/kiosk","_blank")}>
                ⬡ Kiosk Mode
              </button>
            )}
            <button style={S.exportBtn} className="export-btn" onClick={exportCSV}>↓ BrightPay CSV</button>
          </div>
        </div>

        {/* DASHBOARD */}
        {view==="dashboard" && (
          <div style={S.content}>
            <div style={S.statsRow}>
              {[
                {label:"Clocked In Now",val:totalClockedIn,sub:`of ${staff.length} staff`,color:"#00c896"},
                {label:"Today's Shifts",val:todayRecs.length,sub:"completed today",color:"#4da6ff"},
                {label:"Pending Approvals",val:pendingApprovals,sub:"need sign-off",color:pendingApprovals>0?"#ffb84d":"#00c896"},
                {label:"Week Net Hours",val:Math.round(weekHours),sub:"across all sites",color:"#c084fc"},
              ].map(s=>(
                <div key={s.label} style={S.statCard} className="stat-card">
                  <div style={{...S.statNum,color:s.color}}>{s.val}</div>
                  <div style={S.statLabel}>{s.label}</div>
                  <div style={S.statSub}>{s.sub}</div>
                </div>
              ))}
            </div>
            <div style={S.twoCol}>
              <div style={S.card}>
                <div style={S.cardTitle}>Currently Clocked In</div>
                <div style={S.liveList}>
                  {Object.keys(clockedIn).length===0&&<div style={S.empty}>No one clocked in yet today</div>}
                  {Object.entries(clockedIn).map(([id,data])=>{
                    const s=staff.find(x=>x.id===parseInt(id)); if(!s)return null;
                    return(<div key={id} style={S.liveRow}><div style={S.liveAvatar}>{initials(s.name)}</div><div style={{flex:1}}><div style={S.liveName}>{s.name}</div><div style={S.liveSub}>{s.role} · {sites.find(x=>x.id===s.site_id)?.name}</div></div><div style={S.liveTime}>since {data.time}</div></div>);
                  })}
                </div>
              </div>
              <div style={S.card}>
                <div style={S.cardTitle}>Site Snapshot</div>
                <div style={S.siteList}>
                  {sites.filter(site=>staff.some(s=>s.site_id===site.id)).slice(0,10).map(site=>{
                    const ss=staff.filter(s=>s.site_id===site.id);
                    const inToday=attendance.filter(r=>r.site_id===site.id&&r.date===todayStr()).length;
                    const liveNow=ss.filter(s=>clockedIn[s.id]).length;
                    return(<div key={site.id} style={S.siteRow} className="site-row" onClick={()=>{setSelectedSite(site.id);setView("timesheets");}}>
                      <div style={S.siteDot}/><div style={{flex:1}}><div style={S.siteName}>{site.name}</div></div>
                      <div style={S.siteStats}>{liveNow>0&&<span style={S.livePill}>{liveNow} live</span>}<span style={S.siteCount}>{inToday}/{ss.length}</span></div>
                    </div>);
                  })}
                  {isAdmin&&<div style={S.moreLink} onClick={()=>setView("sites")}>View all {sites.length} sites →</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CLOCK */}
        {view==="clock"&&(
          <div style={S.content}>
            <div style={{...S.card,maxWidth:500,margin:"0 auto",textAlign:"center",padding:40}}>
              <div style={{fontSize:13,color:"#555570",marginBottom:16}}>Staff clock in/out via the kiosk terminal</div>
              <button style={{...S.exportBtn,fontSize:15,padding:"14px 32px"}} onClick={()=>window.open("/kiosk","_blank")}>
                Open Kiosk Terminal →
              </button>
              <div style={{fontSize:11,color:"#444458",marginTop:12}}>Opens a PIN-only page for staff to use on a shared tablet or screen</div>
              {isAdmin&&(
                <div style={{marginTop:24,padding:"16px",background:"#0d0d14",borderRadius:10,textAlign:"left"}}>
                  <div style={{fontSize:11,color:"#555570",marginBottom:8,fontWeight:700,letterSpacing:1}}>KIOSK URL PER SITE</div>
                  {sites.slice(0,5).map(s=>(
                    <div key={s.id} style={{fontSize:11,color:"#4da6ff",marginBottom:4}}>
                      /kiosk/{s.id} → {s.name}
                    </div>
                  ))}
                  <div style={{fontSize:11,color:"#444458",marginTop:4}}>…and so on for all 42 sites</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STAFF */}
        {view==="staff"&&(
          <div style={S.content}>
            <div style={S.filterRow}>
              <input style={S.search} placeholder="Search name or role…" value={staffFilter} onChange={e=>setStaffFilter(e.target.value)}/>
              {isAdmin&&<select style={S.select} value={siteFilter} onChange={e=>setSiteFilter(e.target.value)}>
                <option value="all">All Sites ({staff.length} staff)</option>
                {sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>}
            </div>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead><tr>{["Name","Role","Site","Contracted","Status","PIN",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {filteredStaff.slice(0,60).map(s=>{
                    const site=sites.find(x=>x.id===s.site_id); const isIn=!!clockedIn[s.id];
                    return(<tr key={s.id} style={S.tr} className="table-row">
                      <td style={S.td}><div style={S.staffCell}><div style={S.miniAvatar}>{initials(s.name)}</div><div><div style={S.staffName}>{s.name}</div><div style={S.staffEmail}>{s.email}</div></div></div></td>
                      <td style={S.td}><span style={S.roleTag}>{s.role||"—"}</span></td>
                      <td style={S.td}>{site?.name||"—"}</td>
                      <td style={S.td}>{s.contracted_hours}h</td>
                      <td style={S.td}>{isIn?<span style={S.greenPill}>● IN</span>:<span style={S.greyPill}>○ Out</span>}</td>
                      <td style={S.td}><span style={{fontFamily:"monospace",color:"#555570"}}>{s.pin}</span></td>
                      <td style={S.td}><button style={S.viewBtn} onClick={()=>{setSiteFilter(String(s.site_id));setView("timesheets");}}>View →</button></td>
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TIMESHEETS */}
        {view==="timesheets"&&(
          <div style={S.content}>
            <div style={S.filterRow}>
              {isAdmin&&<select style={S.select} value={selectedSite??""} onChange={e=>setSelectedSite(e.target.value===""?null:parseInt(e.target.value))}>
                <option value="">All Sites</option>
                {sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>}
              <label style={S.toggleLabel}><input type="checkbox" checked={approveMode} onChange={e=>setApproveMode(e.target.checked)} style={{marginRight:6}}/>Approval mode</label>
              <button style={S.exportBtn} className="export-btn" onClick={exportCSV}>↓ Export CSV</button>
            </div>
            <div style={S.tableWrap}>
              <table style={S.table}>
                <thead><tr>{["Employee","Site","Date","In","Out","Gross","Break","Net","Status",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {attendance.filter(r=>selectedSite==null||r.site_id===selectedSite).slice(0,80).map(r=>{
                    const s=staff.find(x=>x.id===r.staff_id); const site=sites.find(x=>x.id===r.site_id); if(!s)return null;
                    return(<tr key={r.id} style={S.tr} className="table-row">
                      <td style={S.td}><div style={S.staffCell}><div style={S.miniAvatar}>{initials(s.name)}</div><div style={S.staffName}>{s.name}</div></div></td>
                      <td style={S.td}>{site?.name}</td>
                      <td style={S.td}>{fmtDate(r.date)}</td>
                      <td style={S.td}>{r.clock_in?.slice(0,5)||"—"}</td>
                      <td style={S.td}>{r.clock_out?r.clock_out.slice(0,5):<span style={{color:"#ffb84d"}}>Active</span>}</td>
                      <td style={S.td}>{r.gross_hours?`${r.gross_hours}h`:"—"}</td>
                      <td style={S.td}>{r.break_minutes}m</td>
                      <td style={S.td}><strong style={{color:"#00c896"}}>{r.net_hours?fmt(r.net_hours):"—"}</strong></td>
                      <td style={S.td}>{r.approved?<span style={S.greenPill}>✓ Approved</span>:<span style={S.amberPill}>⏳ Pending</span>}</td>
                      <td style={S.td}>{approveMode&&!r.approved&&r.clock_out&&<button style={S.approveBtn} onClick={()=>approveRecord(r.id)}>Approve</button>}</td>
                    </tr>);
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SITES */}
        {view==="sites"&&isAdmin&&(
          <div style={S.content}>
            <div style={S.siteGrid}>
              {sites.map(site=>{
                const ss=staff.filter(s=>s.site_id===site.id);
                const liveNow=ss.filter(s=>clockedIn[s.id]).length;
                const wh=attendance.filter(r=>r.site_id===site.id).reduce((sum,r)=>sum+(r.net_hours||0),0);
                const pending=attendance.filter(r=>r.site_id===site.id&&!r.approved&&r.clock_out).length;
                return(<div key={site.id} style={{...S.siteCard,...(ss.length===0?{opacity:0.45}:{})}} className="stat-card" onClick={()=>{if(ss.length>0){setSelectedSite(site.id);setView("timesheets");}}}>
                  <div style={S.siteCardTop}><div style={{...S.siteCardDot,background:ss.length===0?"#333":"#00c896"}}/><div style={S.siteCardName}>{site.name}</div></div>
                  <div style={S.siteCardStats}>
                    <div style={S.siteCardStat}><div style={{color:"#00c896",fontWeight:700}}>{liveNow}</div><div style={S.siteCardStatLabel}>Live</div></div>
                    <div style={S.siteCardStat}><div style={{color:"#4da6ff",fontWeight:700}}>{ss.length}</div><div style={S.siteCardStatLabel}>Staff</div></div>
                    <div style={S.siteCardStat}><div style={{color:"#c084fc",fontWeight:700}}>{Math.round(wh)}h</div><div style={S.siteCardStatLabel}>Week</div></div>
                    <div style={S.siteCardStat}><div style={{color:pending>0?"#ffb84d":"#00c896",fontWeight:700}}>{pending}</div><div style={S.siteCardStatLabel}>Pending</div></div>
                  </div>
                </div>);
              })}
            </div>
          </div>
        )}

        {/* REPORTS */}
        {view==="reports"&&(
          <div style={S.content}>
            <div style={S.twoCol}>
              <div style={S.card}>
                <div style={S.cardTitle}>Export Options</div>
                <div style={S.reportBtns}>
                  {[{label:"All Sites — This Week",desc:"Full payroll export for BrightPay"},{label:"Pending Approvals Only",desc:"Filter unapproved records"},{label:"Hours by Site",desc:"Totals per location"},{label:"Staff vs Contracted",desc:"Highlight over/under hours"}].map(r=>(
                    <div key={r.label} style={S.reportRow} className="site-row" onClick={exportCSV}>
                      <div><div style={S.reportLabel}>{r.label}</div><div style={S.reportDesc}>{r.desc}</div></div>
                      <span style={S.exportArrow}>↓</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={S.card}>
                <div style={S.cardTitle}>Weekly Hours by Site</div>
                {sites.filter(site=>staff.some(s=>s.site_id===site.id)).map(site=>{
                  const ss=staff.filter(s=>s.site_id===site.id);
                  const wh=attendance.filter(r=>r.site_id===site.id).reduce((sum,r)=>sum+(r.net_hours||0),0);
                  const contracted=ss.reduce((sum,s)=>sum+(s.contracted_hours||0),0);
                  const pct=Math.min(100,Math.round((wh/Math.max(contracted,1))*100));
                  return(<div key={site.id} style={S.barRow}><div style={S.barLabel}>{site.name.replace(" Pharmacy","").substring(0,14)}</div><div style={S.barTrack}><div style={{...S.barFill,width:`${pct}%`,background:pct<80?"#ffb84d":"#00c896"}}/></div><div style={S.barVal}>{Math.round(wh)}h</div></div>);
                })}
              </div>
            </div>
          </div>
        )}

        {/* PIN MANAGEMENT - Admin only */}
        {view==="pins"&&isAdmin&&(
          <div style={S.content}>
            <PinManager staff={staff} sites={sites} db={db} />
          </div>
        )}
      </main>
    </div>
  );
}


// ── PIN Manager Component ─────────────────────────────────────────────────────
function PinManager({ staff, sites, db }) {
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // staffId
  const [newPin, setNewPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [error, setError] = useState("");

  const filtered = staff.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (sites.find(x=>x.id===s.site_id)?.name||"").toLowerCase().includes(search.toLowerCase())
  );

  const savePin = async (staffId) => {
    if (!/^[0-9]{4}$/.test(newPin)) { setError("PIN must be exactly 4 digits"); return; }
    setSaving(true); setError("");
    try {
      await db.patch("staff", staffId, { pin: newPin });
      setSaved(staffId);
      setEditing(null);
      setNewPin("");
      setTimeout(() => setSaved(null), 3000);
    } catch (e) {
      setError("Failed to save — try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div style={{marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
        <input style={{...{flex:1,background:"#111120",border:"1px solid #1e1e2e",borderRadius:8,padding:"10px 14px",color:"#e8e8f0",fontSize:13,outline:"none"}}}
          placeholder="Search staff or site…" value={search} onChange={e=>setSearch(e.target.value)} />
        <div style={{fontSize:12,color:"#555570"}}>{filtered.length} staff</div>
      </div>
      {saved && <div style={{background:"rgba(0,200,150,.15)",border:"1px solid #00c896",color:"#00c896",padding:"10px 16px",borderRadius:8,marginBottom:16,fontSize:13}}>✓ PIN updated successfully</div>}
      <div style={{borderRadius:12,border:"1px solid #1e1e2e",overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>{["Staff Member","Site","Role","Current PIN","New PIN",""].map(h=><th key={h} style={{background:"#0d0d14",padding:"10px 14px",fontSize:10,fontWeight:700,color:"#555570",textTransform:"uppercase",letterSpacing:0.8,textAlign:"left",borderBottom:"1px solid #1e1e2e"}}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.slice(0,60).map(s => {
              const site = sites.find(x=>x.id===s.site_id);
              const isEditing = editing === s.id;
              return (
                <tr key={s.id} style={{borderBottom:"1px solid #1a1a2a"}}>
                  <td style={{padding:"10px 14px",fontSize:13,color:"#e8e8f0",fontWeight:600}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{width:28,height:28,background:"#1e1e3a",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#888898",flexShrink:0}}>
                        {s.name.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()}
                      </div>
                      {s.name}
                    </div>
                  </td>
                  <td style={{padding:"10px 14px",fontSize:12,color:"#888898"}}>{site?.name||"—"}</td>
                  <td style={{padding:"10px 14px",fontSize:12,color:"#888898"}}>{s.role||"—"}</td>
                  <td style={{padding:"10px 14px"}}>
                    <span style={{fontFamily:"monospace",fontSize:16,letterSpacing:4,color:"#00c896",fontWeight:700}}>{s.pin}</span>
                  </td>
                  <td style={{padding:"10px 14px"}}>
                    {isEditing ? (
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <input
                          style={{width:80,background:"#0d0d14",border:"1px solid #00c896",borderRadius:6,padding:"6px 10px",color:"#e8e8f0",fontSize:14,fontFamily:"monospace",letterSpacing:4,outline:"none",textAlign:"center"}}
                          maxLength={4} placeholder="____" value={newPin}
                          onChange={e=>{ setNewPin(e.target.value.replace(/[^0-9]/g,"")); setError(""); }}
                          autoFocus
                        />
                        {error && <span style={{fontSize:11,color:"#ff6b6b"}}>{error}</span>}
                      </div>
                    ) : (
                      <span style={{fontSize:12,color:"#444458"}}>—</span>
                    )}
                  </td>
                  <td style={{padding:"10px 14px"}}>
                    {isEditing ? (
                      <div style={{display:"flex",gap:6}}>
                        <button style={{background:"#00c896",color:"#0d0d14",border:"none",borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}
                          onClick={()=>savePin(s.id)} disabled={saving}>
                          {saving?"…":"Save"}
                        </button>
                        <button style={{background:"transparent",border:"1px solid #2a2a3a",color:"#888898",borderRadius:6,padding:"6px 12px",fontSize:12,cursor:"pointer"}}
                          onClick={()=>{setEditing(null);setNewPin("");setError("");}}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button style={{background:"transparent",border:"1px solid #2a2a3a",color:"#4da6ff",fontSize:11,padding:"5px 12px",borderRadius:6,cursor:"pointer"}}
                        onClick={()=>{setEditing(s.id);setNewPin("");setError("");}}>
                        Change PIN
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const LS = {
  root:{display:"flex",height:"100vh",fontFamily:"'DM Sans',sans-serif",overflow:"hidden"},
  left:{flex:1,background:"linear-gradient(135deg,#0a0a14,#111128)",display:"flex",alignItems:"center",justifyContent:"center",padding:60,borderRight:"1px solid #1e1e2e"},
  leftInner:{maxWidth:400},
  bigTime:{fontSize:64,fontWeight:800,color:"#e8e8f0",fontVariantNumeric:"tabular-nums",lineHeight:1},
  bigDate:{fontSize:16,color:"#555570",marginTop:8,marginBottom:40},
  tagline:{fontSize:28,fontWeight:700,color:"#e8e8f0",lineHeight:1.3,marginBottom:16},
  sites:{fontSize:13,color:"#00c896",fontWeight:600,letterSpacing:1},
  right:{width:420,background:"#0d0d14",display:"flex",alignItems:"center",justifyContent:"center",padding:48},
  form:{width:"100%"},
  logoRow:{display:"flex",alignItems:"center",gap:10,marginBottom:32},
  logoIcon:{width:40,height:40,background:"linear-gradient(135deg,#00c896,#4da6ff)",borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:"#0d0d14"},
  logoName:{fontSize:15,fontWeight:700,color:"#e8e8f0"},
  logoSub:{fontSize:11,color:"#555570"},
  formTitle:{fontSize:24,fontWeight:800,color:"#e8e8f0",marginBottom:6},
  formSub:{fontSize:13,color:"#555570",marginBottom:28},
  error:{background:"rgba(255,75,75,.1)",border:"1px solid rgba(255,75,75,.3)",color:"#ff6b6b",padding:"10px 14px",borderRadius:8,fontSize:13,marginBottom:16},
  field:{marginBottom:16},
  label:{display:"block",fontSize:11,fontWeight:700,color:"#555570",letterSpacing:0.8,textTransform:"uppercase",marginBottom:6},
  input:{width:"100%",background:"#111120",border:"1px solid #1e1e2e",borderRadius:8,padding:"12px 14px",color:"#e8e8f0",fontSize:14,outline:"none"},
  btn:{width:"100%",background:"#00c896",color:"#0d0d14",border:"none",borderRadius:10,padding:"14px",fontSize:15,fontWeight:700,cursor:"pointer",marginTop:8},
  kioskNote:{fontSize:11,color:"#444458",marginTop:20,textAlign:"center"},
};

const KS = {
  root:{minHeight:"100vh",background:"#0d0d14",color:"#e8e8f0",fontFamily:"'DM Sans',sans-serif"},
  header:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"20px 32px",borderBottom:"1px solid #1e1e2e",background:"#111120"},
  logo:{display:"flex",alignItems:"center",gap:8,fontSize:16,fontWeight:700,color:"#e8e8f0"},
  logoIcon:{width:32,height:32,background:"linear-gradient(135deg,#00c896,#4da6ff)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:800,color:"#0d0d14"},
  siteName:{fontSize:14,fontWeight:600,color:"#00c896"},
  clock:{fontSize:20,fontWeight:800,fontVariantNumeric:"tabular-nums",color:"#e8e8f0"},
  body:{display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"40px 20px"},
  siteSelect:{maxWidth:600,width:"100%"},
  selectTitle:{fontSize:20,fontWeight:700,color:"#e8e8f0",marginBottom:20,textAlign:"center"},
  siteGrid:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10},
  siteBtn:{background:"#111120",border:"1px solid #1e1e2e",borderRadius:10,padding:"16px",fontSize:13,fontWeight:600,color:"#c8c8d8",cursor:"pointer",textAlign:"center",transition:"all .15s"},
  pinArea:{maxWidth:360,width:"100%",textAlign:"center"},
  date:{fontSize:14,color:"#555570",marginBottom:20},
  toggleRow:{display:"flex",gap:10,justifyContent:"center",marginBottom:24},
  toggleBtn:{background:"#111120",border:"1px solid #1e1e2e",borderRadius:10,padding:"12px 24px",fontSize:14,fontWeight:600,color:"#888898",cursor:"pointer"},
  toggleActive:{background:"rgba(0,200,150,.15)",border:"1px solid #00c896",color:"#00c896"},
  toggleActiveOut:{background:"rgba(255,107,107,.15)",border:"1px solid #ff6b6b",color:"#ff6b6b"},
  pinDisplay:{display:"flex",justifyContent:"center",gap:20,marginBottom:12},
  pinDot:{width:20,height:20,border:"2px solid #2a2a3a",borderRadius:"50%",transition:"background .1s"},
  pinError:{fontSize:13,color:"#ff6b6b",marginBottom:8,minHeight:20},
  pinHint:{fontSize:13,color:"#444458",marginBottom:8,minHeight:20},
  pinGrid:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:24},
  pinBtn:{background:"#111120",border:"1px solid #1e1e2e",color:"#e8e8f0",fontSize:24,fontWeight:600,padding:"20px",borderRadius:12,cursor:"pointer",transition:"background .15s"},
  notif:{position:"fixed",top:20,right:20,zIndex:2000,color:"#0d0d14",fontWeight:700,fontSize:14,padding:"14px 24px",borderRadius:10,boxShadow:"0 4px 20px rgba(0,0,0,.4)",animation:"fadeIn .2s ease"},
  liveList:{background:"#111120",border:"1px solid #1e1e2e",borderRadius:10,padding:"12px",marginBottom:16,textAlign:"left"},
  liveTitle:{fontSize:10,fontWeight:700,color:"#555570",letterSpacing:1,textTransform:"uppercase",marginBottom:8},
  liveRow:{display:"flex",alignItems:"center",gap:8,marginBottom:6},
  liveAvatar:{width:28,height:28,background:"linear-gradient(135deg,#00c896,#4da6ff)",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#0d0d14",flexShrink:0},
  liveName:{flex:1,fontSize:13,fontWeight:600,color:"#e8e8f0"},
  liveTime:{fontSize:11,color:"#888898"},
  changeSite:{background:"transparent",border:"none",color:"#555570",fontSize:12,cursor:"pointer",marginTop:8},
};

const S = {
  root:{display:"flex",height:"100vh",background:"#0d0d14",color:"#e8e8f0",fontFamily:"'DM Sans',sans-serif",overflow:"hidden"},
  spinner:{width:32,height:32,border:"3px solid #1e1e2e",borderTop:"3px solid #00c896",borderRadius:"50%",animation:"spin 1s linear infinite"},
  sidebar:{width:220,background:"#111120",borderRight:"1px solid #1e1e2e",display:"flex",flexDirection:"column",padding:"24px 0",flexShrink:0},
  logo:{display:"flex",alignItems:"center",gap:10,padding:"0 20px 24px",borderBottom:"1px solid #1e1e2e"},
  logoIcon:{width:36,height:36,background:"linear-gradient(135deg,#00c896,#4da6ff)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,color:"#0d0d14",flexShrink:0},
  logoName:{fontSize:13,fontWeight:700,letterSpacing:1,color:"#e8e8f0"},
  logoSub:{fontSize:10,color:"#555570",letterSpacing:0.5},
  nav:{flex:1,padding:"16px 10px"},
  navItem:{width:"100%",display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:"transparent",border:"none",color:"#888898",fontSize:13,fontWeight:500,cursor:"pointer",borderRadius:8,textAlign:"left",transition:"all .15s",marginBottom:2},
  navActive:{background:"#1a1a2e",color:"#00c896"},
  navIcon:{fontSize:14,width:18,textAlign:"center"},
  badge:{marginLeft:"auto",background:"#ffb84d",color:"#0d0d14",borderRadius:10,fontSize:10,fontWeight:700,padding:"1px 6px"},
  sidebarBottom:{padding:"16px 20px",borderTop:"1px solid #1e1e2e",fontSize:11,color:"#555570"},
  sidebarStat:{display:"flex",alignItems:"center",gap:6,marginBottom:4},
  sidebarStatNum:{color:"#00c896",fontWeight:700,fontSize:13},
  main:{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"},
  header:{padding:"20px 28px",borderBottom:"1px solid #1e1e2e",display:"flex",alignItems:"center",justifyContent:"space-between",background:"#0f0f1a",flexShrink:0},
  headerTitle:{fontSize:18,fontWeight:700,color:"#e8e8f0"},
  headerDate:{fontSize:12,color:"#555570",marginTop:2},
  content:{flex:1,overflow:"auto",padding:"24px 28px"},
  statsRow:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:16,marginBottom:24},
  statCard:{background:"#111120",border:"1px solid #1e1e2e",borderRadius:12,padding:"20px",cursor:"pointer"},
  statNum:{fontSize:32,fontWeight:800,lineHeight:1},
  statLabel:{fontSize:12,fontWeight:600,color:"#888898",marginTop:6,letterSpacing:0.5,textTransform:"uppercase"},
  statSub:{fontSize:11,color:"#444458",marginTop:2},
  twoCol:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16},
  card:{background:"#111120",border:"1px solid #1e1e2e",borderRadius:12,padding:"20px"},
  cardTitle:{fontSize:12,fontWeight:700,color:"#555570",letterSpacing:1,textTransform:"uppercase",marginBottom:16},
  liveList:{display:"flex",flexDirection:"column",gap:8,maxHeight:320,overflowY:"auto"},
  liveRow:{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:"#0d0d14",borderRadius:8},
  liveAvatar:{width:32,height:32,background:"linear-gradient(135deg,#00c896,#4da6ff)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#0d0d14",flexShrink:0},
  liveName:{fontSize:13,fontWeight:600,color:"#e8e8f0"},
  liveSub:{fontSize:11,color:"#555570"},
  liveTime:{fontSize:11,color:"#888898",fontVariantNumeric:"tabular-nums"},
  siteList:{display:"flex",flexDirection:"column",gap:4},
  siteRow:{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,cursor:"pointer",transition:"background .15s"},
  siteDot:{width:6,height:6,background:"#00c896",borderRadius:"50%",flexShrink:0},
  siteName:{fontSize:13,color:"#c8c8d8"},
  siteStats:{display:"flex",alignItems:"center",gap:6},
  livePill:{background:"rgba(0,200,150,.15)",color:"#00c896",fontSize:10,fontWeight:700,padding:"2px 6px",borderRadius:10},
  siteCount:{fontSize:11,color:"#555570"},
  moreLink:{fontSize:11,color:"#4da6ff",marginTop:12,cursor:"pointer",textAlign:"center"},
  empty:{fontSize:13,color:"#444458",textAlign:"center",padding:"20px 0"},
  filterRow:{display:"flex",gap:12,marginBottom:20,alignItems:"center"},
  search:{flex:1,background:"#111120",border:"1px solid #1e1e2e",borderRadius:8,padding:"10px 14px",color:"#e8e8f0",fontSize:13,outline:"none"},
  select:{background:"#111120",border:"1px solid #1e1e2e",borderRadius:8,padding:"10px 14px",color:"#e8e8f0",fontSize:13,outline:"none",cursor:"pointer"},
  toggleLabel:{fontSize:13,color:"#888898",display:"flex",alignItems:"center",cursor:"pointer"},
  tableWrap:{overflowX:"auto",borderRadius:12,border:"1px solid #1e1e2e"},
  table:{width:"100%",borderCollapse:"collapse"},
  th:{background:"#0d0d14",padding:"10px 14px",fontSize:10,fontWeight:700,color:"#555570",textTransform:"uppercase",letterSpacing:0.8,textAlign:"left",borderBottom:"1px solid #1e1e2e",whiteSpace:"nowrap"},
  tr:{borderBottom:"1px solid #1a1a2a",transition:"background .1s",cursor:"pointer"},
  td:{padding:"10px 14px",fontSize:13,color:"#c8c8d8",verticalAlign:"middle",whiteSpace:"nowrap"},
  staffCell:{display:"flex",alignItems:"center",gap:8},
  miniAvatar:{width:28,height:28,background:"#1e1e3a",borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#888898",flexShrink:0},
  staffName:{fontSize:13,fontWeight:600,color:"#e8e8f0"},
  staffEmail:{fontSize:10,color:"#444458"},
  roleTag:{background:"#1a1a2e",color:"#888898",fontSize:10,fontWeight:600,padding:"3px 8px",borderRadius:6,whiteSpace:"nowrap"},
  greenPill:{background:"rgba(0,200,150,.15)",color:"#00c896",fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:10},
  greyPill:{background:"#1a1a2a",color:"#555570",fontSize:10,padding:"3px 8px",borderRadius:10},
  amberPill:{background:"rgba(255,184,77,.1)",color:"#ffb84d",fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:10},
  viewBtn:{background:"transparent",border:"1px solid #2a2a3a",color:"#4da6ff",fontSize:11,padding:"4px 10px",borderRadius:6,cursor:"pointer"},
  approveBtn:{background:"rgba(0,200,150,.15)",border:"1px solid #00c896",color:"#00c896",fontSize:11,padding:"4px 10px",borderRadius:6,cursor:"pointer"},
  exportBtn:{background:"#00c896",color:"#0d0d14",border:"none",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:0.5},
  siteGrid:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12},
  siteCard:{background:"#111120",border:"1px solid #1e1e2e",borderRadius:12,padding:16,cursor:"pointer"},
  siteCardTop:{display:"flex",alignItems:"center",gap:8,marginBottom:12},
  siteCardDot:{width:8,height:8,borderRadius:"50%",flexShrink:0},
  siteCardName:{fontSize:11,fontWeight:600,color:"#c8c8d8"},
  siteCardStats:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8},
  siteCardStat:{textAlign:"center",background:"#0d0d14",borderRadius:8,padding:"8px"},
  siteCardStatLabel:{fontSize:10,color:"#444458",marginTop:2},
  reportBtns:{display:"flex",flexDirection:"column",gap:8},
  reportRow:{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 16px",background:"#0d0d14",borderRadius:8,cursor:"pointer"},
  reportLabel:{fontSize:13,fontWeight:600,color:"#e8e8f0"},
  reportDesc:{fontSize:11,color:"#555570",marginTop:2},
  exportArrow:{fontSize:18,color:"#4da6ff"},
  barRow:{display:"flex",alignItems:"center",gap:10,marginBottom:10},
  barLabel:{fontSize:11,color:"#888898",width:100,flexShrink:0},
  barTrack:{flex:1,height:6,background:"#1a1a2a",borderRadius:3,overflow:"hidden"},
  barFill:{height:"100%",borderRadius:3,transition:"width .3s"},
  barVal:{fontSize:11,color:"#c8c8d8",width:36,textAlign:"right"},
  notif:{position:"fixed",top:20,right:20,zIndex:2000,color:"#0d0d14",fontWeight:700,fontSize:13,padding:"12px 20px",borderRadius:10,boxShadow:"0 4px 20px rgba(0,0,0,.4)"},
};

const loginCss = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .login-btn:hover { opacity: 0.9; }
`;

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; }
  @keyframes spin { to { transform: rotate(360deg); } }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #0d0d14; }
  ::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 4px; }
  .nav-item:hover { background: #1a1a2e !important; color: #c8c8d8 !important; }
  .stat-card:hover { border-color: #2a2a3a !important; transform: translateY(-1px); transition: all .15s; }
  .table-row:hover td { background: #13131f; }
  .site-row:hover { background: #13131f !important; }
  .export-btn:hover { opacity: 0.9; }
`;
