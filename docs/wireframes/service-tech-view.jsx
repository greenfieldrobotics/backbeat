import { useState } from "react";

const TEAL = "#009D9A";
const YELLOW = "#FFC433";
const DARK = "#1A1A1A";
const LIGHT_BG = "#F5F5F5";
const BORDER = "#E0E0E0";
const WHITE = "#FFFFFF";

// Mock data
const MOCK_PARTS = [
  { id: 1, part_number: "EL-0042", description: "Motor Controller Board v3", qty: 12, location: "Truck #3" },
  { id: 2, part_number: "CS-0118", description: "Cutter Blade Assembly - 18in", qty: 6, location: "Truck #3" },
  { id: 3, part_number: "SN-0007", description: "LiDAR Sensor Module", qty: 3, location: "Truck #3" },
  { id: 4, part_number: "TR-0031", description: "Track Belt - Left Side", qty: 8, location: "Truck #3" },
  { id: 5, part_number: "WR-0055", description: "Wiring Harness - Main Power", qty: 4, location: "Truck #3" },
  { id: 6, part_number: "HW-0201", description: 'Hex Bolt M8x25 (bag/50)', qty: 15, location: "Truck #3" },
  { id: 7, part_number: "EL-0099", description: "GPS Antenna - Dual Band", qty: 2, location: "Truck #3" },
  { id: 8, part_number: "CS-0122", description: "Cutter Motor 48V BLDC", qty: 1, location: "Truck #3" },
];

const MOCK_BOTS = ["Bot-14", "Bot-15", "Bot-16", "Bot-22", "Bot-23", "Bot-30"];

const MOCK_RECENT = [
  { part: "CS-0118", desc: "Cutter Blade Assembly", qty: 1, bot: "Bot-22", time: "10 min ago" },
  { part: "HW-0201", desc: "Hex Bolt M8x25", qty: 2, bot: "Bot-15", time: "1 hr ago" },
  { part: "WR-0055", desc: "Wiring Harness", qty: 1, bot: "Bot-14", time: "3 hrs ago" },
];

function ServiceTechView() {
  const [screen, setScreen] = useState("home"); // home, pull, search, confirm, done
  const [selectedPart, setSelectedPart] = useState(null);
  const [selectedBot, setSelectedBot] = useState("");
  const [pullQty, setPullQty] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("home");

  const filteredParts = MOCK_PARTS.filter(
    (p) =>
      p.part_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const resetFlow = () => {
    setScreen("home");
    setSelectedPart(null);
    setSelectedBot("");
    setPullQty(1);
    setSearchTerm("");
  };

  const navTo = (nav) => {
    setActiveNav(nav);
    setSidebarOpen(false);
    if (nav === "home") resetFlow();
    if (nav === "pull") { resetFlow(); setScreen("pull"); }
  };

  // Sidebar
  const Sidebar = () => (
    <div
      style={{
        position: "fixed", top: 0, left: sidebarOpen ? 0 : -260, width: 250,
        height: "100vh", background: TEAL, color: WHITE, zIndex: 100,
        transition: "left 0.2s ease", padding: "20px 0", display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "0 20px 24px", borderBottom: `1px solid rgba(255,255,255,0.2)` }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>Backbeat</div>
        <span
          style={{
            background: YELLOW, color: DARK, fontSize: 11, fontWeight: 700,
            padding: "2px 8px", borderRadius: 4, marginTop: 4, display: "inline-block",
          }}
        >
          Stash
        </span>
      </div>
      <nav style={{ flex: 1, padding: "12px 0" }}>
        {[
          { id: "home", label: "Home", icon: "🏠" },
          { id: "pull", label: "Pull a Part", icon: "📦" },
          { id: "inventory", label: "My Inventory", icon: "📋" },
          { id: "history", label: "My History", icon: "🕐" },
          { id: "returns", label: "Return a Part", icon: "↩️" },
        ].map((item) => (
          <div
            key={item.id}
            onClick={() => navTo(item.id)}
            style={{
              padding: "12px 20px", cursor: "pointer", display: "flex",
              alignItems: "center", gap: 10, fontSize: 15,
              background: activeNav === item.id ? "rgba(255,255,255,0.15)" : "transparent",
              borderLeft: activeNav === item.id ? `3px solid ${YELLOW}` : "3px solid transparent",
            }}
          >
            <span style={{ fontSize: 18 }}>{item.icon}</span> {item.label}
          </div>
        ))}
      </nav>
      <div style={{ padding: "16px 20px", borderTop: `1px solid rgba(255,255,255,0.2)`, fontSize: 13 }}>
        <div style={{ fontWeight: 500 }}>Tyler Jensen</div>
        <div style={{ opacity: 0.7, fontSize: 12 }}>Service Tech • Truck #3</div>
        <div
          onClick={() => {}}
          style={{ marginTop: 8, opacity: 0.7, cursor: "pointer", fontSize: 12 }}
        >
          Sign out
        </div>
      </div>
    </div>
  );

  // Overlay
  const Overlay = () =>
    sidebarOpen ? (
      <div
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.4)", zIndex: 99,
        }}
      />
    ) : null;

  // Top bar
  const TopBar = ({ title }) => (
    <div
      style={{
        display: "flex", alignItems: "center", padding: "14px 16px",
        background: TEAL, color: WHITE, position: "sticky", top: 0, zIndex: 50,
      }}
    >
      <div
        onClick={() => setSidebarOpen(true)}
        style={{ cursor: "pointer", fontSize: 22, marginRight: 14, lineHeight: 1 }}
      >
        ☰
      </div>
      <div style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>{title}</div>
      <div style={{ fontSize: 12, opacity: 0.8 }}>Truck #3</div>
    </div>
  );

  // HOME SCREEN
  const HomeScreen = () => (
    <div style={{ minHeight: "100vh", background: LIGHT_BG }}>
      <TopBar title="Backbeat · Stash" />
      <div style={{ padding: 16 }}>
        {/* Big Pull Button */}
        <div
          onClick={() => { setScreen("pull"); setActiveNav("pull"); }}
          style={{
            background: TEAL, color: WHITE, borderRadius: 12, padding: "28px 20px",
            textAlign: "center", cursor: "pointer", marginBottom: 20,
            boxShadow: "0 4px 12px rgba(0,157,154,0.3)",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Pull a Part</div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>Issue from your truck inventory</div>
        </div>

        {/* Quick Stats */}
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Parts on Truck", value: MOCK_PARTS.length, color: TEAL },
            { label: "Pulled Today", value: "3", color: TEAL },
            { label: "Low Stock", value: "1", color: YELLOW },
          ].map((stat, i) => (
            <div
              key={i}
              style={{
                flex: 1, background: WHITE, borderRadius: 8, padding: "14px 10px",
                textAlign: "center", border: `1px solid ${BORDER}`,
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Recent Activity */}
        <div style={{ background: WHITE, borderRadius: 8, border: `1px solid ${BORDER}` }}>
          <div
            style={{
              padding: "12px 14px", fontWeight: 700, fontSize: 14, color: TEAL,
              borderBottom: `1px solid ${BORDER}`,
            }}
          >
            Recent Pulls
          </div>
          {MOCK_RECENT.map((item, i) => (
            <div
              key={i}
              style={{
                padding: "12px 14px", borderBottom: i < MOCK_RECENT.length - 1 ? `1px solid ${LIGHT_BG}` : "none",
                display: "flex", alignItems: "center", gap: 10,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  <span style={{ fontFamily: "monospace", color: TEAL }}>{item.part}</span>{" "}
                  <span style={{ color: "#666", fontWeight: 400 }}>× {item.qty}</span>
                </div>
                <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                  → {item.bot} · {item.time}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // PULL FLOW — Part Search
  const PullSearchScreen = () => (
    <div style={{ minHeight: "100vh", background: LIGHT_BG }}>
      <TopBar title="Pull a Part" />
      <div style={{ padding: 16 }}>
        {/* Search */}
        <input
          type="text"
          placeholder="Search part # or description..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: "100%", padding: "14px 14px", fontSize: 15, borderRadius: 8,
            border: `2px solid ${TEAL}`, outline: "none", marginBottom: 12,
            boxSizing: "border-box", fontFamily: "inherit",
          }}
        />
        <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>
          {filteredParts.length} parts on your truck
        </div>

        {/* Part List */}
        {filteredParts.map((part) => (
          <div
            key={part.id}
            onClick={() => { setSelectedPart(part); setScreen("confirm"); }}
            style={{
              background: WHITE, borderRadius: 8, padding: "14px", marginBottom: 8,
              border: `1px solid ${BORDER}`, cursor: "pointer", display: "flex",
              alignItems: "center",
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 15, color: TEAL }}>
                {part.part_number}
              </div>
              <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>{part.description}</div>
            </div>
            <div
              style={{
                textAlign: "right", fontSize: 13, color: part.qty <= 2 ? "#D4760A" : "#555",
                fontWeight: part.qty <= 2 ? 700 : 400,
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700 }}>{part.qty}</div>
              <div style={{ fontSize: 11 }}>avail</div>
            </div>
          </div>
        ))}

        {/* Cancel */}
        <div
          onClick={resetFlow}
          style={{
            textAlign: "center", padding: 14, color: "#888", cursor: "pointer",
            fontSize: 14, marginTop: 8,
          }}
        >
          Cancel
        </div>
      </div>
    </div>
  );

  // PULL FLOW — Confirm
  const ConfirmScreen = () => (
    <div style={{ minHeight: "100vh", background: LIGHT_BG }}>
      <TopBar title="Confirm Pull" />
      <div style={{ padding: 16 }}>
        {/* Part Card */}
        <div
          style={{
            background: WHITE, borderRadius: 8, padding: 16,
            border: `1px solid ${BORDER}`, marginBottom: 20, borderTop: `3px solid ${TEAL}`,
          }}
        >
          <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: TEAL }}>
            {selectedPart?.part_number}
          </div>
          <div style={{ fontSize: 14, color: "#555", marginTop: 4 }}>
            {selectedPart?.description}
          </div>
          <div style={{ fontSize: 13, color: "#888", marginTop: 4 }}>
            Available: {selectedPart?.qty} at {selectedPart?.location}
          </div>
        </div>

        {/* Quantity */}
        <label style={{ fontSize: 12, fontWeight: 500, color: "#555", display: "block", marginBottom: 6 }}>
          QUANTITY
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div
            onClick={() => setPullQty(Math.max(1, pullQty - 1))}
            style={{
              width: 44, height: 44, borderRadius: 8, background: LIGHT_BG,
              border: `1px solid ${BORDER}`, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 22, cursor: "pointer", fontWeight: 700,
            }}
          >
            −
          </div>
          <div
            style={{
              fontSize: 28, fontWeight: 700, fontFamily: "monospace", width: 60,
              textAlign: "center", color: DARK,
            }}
          >
            {pullQty}
          </div>
          <div
            onClick={() => setPullQty(Math.min(selectedPart?.qty || 1, pullQty + 1))}
            style={{
              width: 44, height: 44, borderRadius: 8, background: LIGHT_BG,
              border: `1px solid ${BORDER}`, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 22, cursor: "pointer", fontWeight: 700,
            }}
          >
            +
          </div>
        </div>

        {/* Target Bot */}
        <label style={{ fontSize: 12, fontWeight: 500, color: "#555", display: "block", marginBottom: 6 }}>
          TARGET BOT / VEHICLE <span style={{ color: YELLOW }}>*</span>
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
          {MOCK_BOTS.map((bot) => (
            <div
              key={bot}
              onClick={() => setSelectedBot(bot)}
              style={{
                padding: "10px 16px", borderRadius: 8, fontSize: 14, cursor: "pointer",
                fontWeight: selectedBot === bot ? 700 : 400,
                background: selectedBot === bot ? TEAL : WHITE,
                color: selectedBot === bot ? WHITE : DARK,
                border: `1px solid ${selectedBot === bot ? TEAL : BORDER}`,
              }}
            >
              {bot}
            </div>
          ))}
        </div>

        {/* Reason */}
        <label style={{ fontSize: 12, fontWeight: 500, color: "#555", display: "block", marginBottom: 6 }}>
          REASON
        </label>
        <select
          style={{
            width: "100%", padding: "12px", fontSize: 14, borderRadius: 8,
            border: `1px solid ${BORDER}`, marginBottom: 28, fontFamily: "inherit",
            background: WHITE, boxSizing: "border-box",
          }}
        >
          <option>Field Repair</option>
          <option>Scheduled Maintenance</option>
          <option>Emergency Replacement</option>
          <option>R&D / Testing</option>
        </select>

        {/* Submit */}
        <div
          onClick={() => selectedBot && setScreen("done")}
          style={{
            background: selectedBot ? TEAL : "#ccc", color: WHITE, padding: "16px",
            borderRadius: 8, textAlign: "center", fontSize: 16, fontWeight: 700,
            cursor: selectedBot ? "pointer" : "default",
            boxShadow: selectedBot ? "0 4px 12px rgba(0,157,154,0.3)" : "none",
          }}
        >
          Pull {pullQty} × {selectedPart?.part_number} → {selectedBot || "Select bot"}
        </div>

        {/* Cancel */}
        <div
          onClick={() => setScreen("pull")}
          style={{
            textAlign: "center", padding: 14, color: "#888", cursor: "pointer",
            fontSize: 14, marginTop: 8,
          }}
        >
          Back to search
        </div>
      </div>
    </div>
  );

  // PULL FLOW — Done
  const DoneScreen = () => (
    <div style={{ minHeight: "100vh", background: LIGHT_BG }}>
      <TopBar title="Done" />
      <div style={{ padding: 16, textAlign: "center", paddingTop: 60 }}>
        <div
          style={{
            width: 80, height: 80, borderRadius: "50%", background: TEAL,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px", fontSize: 36, color: WHITE,
          }}
        >
          ✓
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: DARK, marginBottom: 8 }}>
          Part Pulled
        </div>
        <div style={{ fontSize: 15, color: "#555", marginBottom: 4 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 700, color: TEAL }}>
            {selectedPart?.part_number}
          </span>{" "}
          × {pullQty}
        </div>
        <div style={{ fontSize: 14, color: "#888", marginBottom: 4 }}>
          → {selectedBot} · Field Repair
        </div>
        <div style={{ fontSize: 13, color: "#888", marginBottom: 40 }}>
          {selectedPart?.qty - pullQty} remaining on Truck #3
        </div>

        <div style={{ display: "flex", gap: 10, maxWidth: 320, margin: "0 auto" }}>
          <div
            onClick={() => { setScreen("pull"); setSelectedPart(null); setSelectedBot(""); setPullQty(1); setSearchTerm(""); }}
            style={{
              flex: 1, background: TEAL, color: WHITE, padding: "14px",
              borderRadius: 8, textAlign: "center", fontSize: 14, fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Pull Another
          </div>
          <div
            onClick={resetFlow}
            style={{
              flex: 1, background: WHITE, color: TEAL, padding: "14px",
              borderRadius: 8, textAlign: "center", fontSize: 14, fontWeight: 700,
              cursor: "pointer", border: `1px solid ${TEAL}`,
            }}
          >
            Done
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Kumbh Sans', 'Segoe UI', sans-serif", maxWidth: 420, margin: "0 auto", position: "relative", overflow: "hidden" }}>
      <Sidebar />
      <Overlay />
      {screen === "home" && <HomeScreen />}
      {screen === "pull" && <PullSearchScreen />}
      {screen === "confirm" && <ConfirmScreen />}
      {screen === "done" && <DoneScreen />}
    </div>
  );
}

export default ServiceTechView;
