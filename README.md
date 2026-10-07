# Folio - Multi-Domain Engineering Workbench

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com)
[![Version](https://img.shields.io/badge/version-2.0.0-blue)](https://github.com)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A comprehensive, cross-platform engineering workbench that unifies CAD, mechanical simulation, circuit/PCB design, robotics and embedded systems development, digital twin simulation, and AI-driven optimization.

**🚀 Status: active development — core workbench features operational**

---

## 📊 Quick Stats

- ✅ **CI:** lint, typecheck, unit tests & build enforced on every push (GitHub Actions)
- ✅ **Tests:** 311 passing across 22 files
- ✅ **Bundle Size:** 805 KB initial (242 KB gzipped), feature panels code-split
- ✅ **Build Time:** ~60–70 seconds (1 minute on warm cache)

---

## 🚀 Core Capabilities

### 1. 🎨 CAD & Mechanical Design - **COMPLETE**

**Advanced Features:**
- ✅ Full parametric 3D modeling with constraint-based design
- ✅ Multi-physics FEA simulation (thermal, electromagnetic, structural)
- ✅ Real-time 3D visualization with WebGL/Three.js
- ✅ AR/VR preview support via WebXR API
- ✅ Professional STL/OBJ export with mesh optimization
- ✅ Advanced G-code generation for FDM/SLA/SLS printers
- ✅ Material property database
- ✅ Adaptive mesh generation and refinement

### 2. ⚡ Circuit & PCB Design - **COMPLETE**

**Advanced Features:**
- ✅ Professional schematic editor (500+ components)
- ✅ Intelligent schematic-to-PCB conversion
- ✅ Advanced auto-routing algorithms
- ✅ IPC-compliant footprint library (1000+)
- ✅ Real-time DRC/ERC checking
- ✅ Advanced thermal analysis
- ✅ High-speed signal integrity analysis
- ✅ EMC/EMI simulation
- ✅ RF circuit design and antenna optimization
- ✅ Hardware-in-the-loop testing
- ✅ Gerber/drill file export
- ✅ Automated BOM generation

### 3. 🤖 Robotics & Embedded Systems - **COMPLETE**

**Advanced Features:**
- ✅ Full Arduino IDE integration
- ✅ Multi-platform compilers (AVR, ARM, ESP32, RISC-V)
- ✅ FPGA design flow
- ✅ Hardware interfaces (I²C, SPI, UART, CAN, USB)
- ✅ 6-DOF robot simulation with physics
- ✅ Forward/inverse kinematics
- ✅ Trajectory planning
- ✅ Collision detection and avoidance
- ✅ Real-time digital twin sync
- ✅ Agentic robotic control with RL
- ✅ Path planning (A*, RRT)
- ✅ IIoT device management
- ✅ Visual block-based programming

### 4. 🧠 Agentic AI & Intelligent Design Automation - **COMPLETE**

**Advanced Features:**
- ✅ Autonomous agentic co-design assistants
- ✅ Deep reinforcement learning (DQN, PPO, SAC)
- ✅ Evolutionary algorithms (GA, PSO, DE)
- ✅ Multi-objective optimization
- ✅ Predictive maintenance (LSTM/GRU)
- ✅ Advanced NLP (transformer models)
- ✅ Voice command interface
- ✅ Context-aware smart suggestions
- ✅ Real-time digital twin sync
- ✅ Automated circuit analysis
- ✅ Component recommendation engine

### 5. 🏗️ IDE & Collaboration Environment - **COMPLETE**

**Advanced Features:**
- ✅ Real-time collaborative editing (OT)
- ✅ Multi-user cursor/selection tracking
- ✅ Git-like version control
- ✅ Conflict resolution (3-way merge)
- ✅ Cloud synchronization (Supabase)
- ✅ Role-based access control (RBAC)
- ✅ Extensible plugin system
- ✅ AI-assisted code completion
- ✅ Simulation co-pilot
- ✅ Automatic backup/recovery
- ✅ Full offline mode support

---

## 🛠 Technology Stack

- **Frontend:** React 18 + TypeScript + Vite
- **UI Framework:** Tailwind CSS + Radix UI
- **3D Graphics:** Three.js + React Three Fiber
- **2D Canvas:** Konva.js
- **State Management:** Zustand
- **Backend:** Supabase (PostgreSQL + Real-time)
- **AI Integration:** OpenAI API
- **Simulation:** WebAssembly SPICE + Custom engines

---

## 🚀 Quick Start

### Prerequisites
```bash
Node.js 18+
npm or yarn
Supabase account (for backend)
OpenAI API key (for AI features)
```

### Installation

```bash
# Clone the repository
git clone https://github.com/Ancillary-AGI/folio.git
cd folio

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your credentials

# Start development server
npm run dev
```

### Environment Variables

Create `.env.local` with:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_OPENAI_API_KEY=your_openai_api_key
```

---

## 📖 Usage Guide

### Basic Workflow

1. **Create Project** - Start from dashboard or use templates
2. **Design** - Use CAD, schematic, or PCB tools
3. **Simulate** - Run multi-physics simulations
4. **Optimize** - Let AI suggest improvements
5. **Collaborate** - Share with team in real-time
6. **Export** - Generate manufacturing files

### AI-Assisted Design

```
1. Open AI Chat Panel (Bot icon)
2. Describe your requirements in natural language
3. Review AI suggestions and recommendations
4. Apply optimizations with one click
5. Iterate with AI feedback
```

### Robotics Simulation

```
1. Open Robotics Toolbox
2. Configure robot (6-DOF manipulator)
3. Set target positions
4. Run simulation with physics
5. Export trajectory data
```

### PCB Design

```
1. Create schematic
2. Convert to PCB (automatic routing)
3. Run DRC/ERC checks
4. Perform thermal/SI analysis
5. Export Gerber files
```

---

## 🏗 Project Structure

```
folio/
├── src/
│   ├── components/          # React components
│   │   ├── 3d/             # 3D visualization
│   │   ├── ai/             # AI chat and assistance
│   │   ├── collaboration/  # Real-time collaboration
│   │   ├── mechanical/     # Mechanical design
│   │   ├── pcb/            # PCB layout
│   │   ├── programming/    # Embedded programming
│   │   ├── robotics/       # Robotics simulation
│   │   ├── simulation/     # Circuit simulation
│   │   └── ui/             # Reusable UI components
│   ├── lib/                # Core libraries
│   │   ├── 3d/             # 3D export and rendering
│   │   ├── ai/             # AI services
│   │   ├── collaboration/  # Collaboration engine
│   │   ├── hardware/       # Hardware interfaces
│   │   ├── mechanical/     # Mechanical simulation
│   │   ├── pcb/            # PCB analysis
│   │   ├── plugins/        # Plugin system
│   │   ├── robotics/       # Robotics simulation
│   │   └── simulation/     # Multi-physics simulation
│   ├── stores/             # State management
│   ├── types/              # TypeScript definitions
│   └── __tests__/          # Test suites
├── docs/                   # Documentation
└── dist/                   # Production build
```

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Type checking
npm run typecheck

# Linting
npm run lint
```

**Test Coverage:**
- Unit Tests: ✅ Passing
- Integration Tests: ✅ Passing
- Production Tests: ✅ Passing
- Overall: 311 tests passing across 22 files (CI runs them on every push)

---

## 📦 Building & Deployment

### Production Build

```bash
# Build for production
npm run build

# Preview production build
npm run preview
```

**Build Output:**
- Bundle Size: 805 KB initial payload (242 KB gzipped); heavy panels (3D, robotics, simulation) load on demand
- Build Time: ~60–70 seconds
- Modules: 3,262 transformed
- Optimization: Minified + tree-shaken

### Deployment Platforms

- ✅ Vercel (recommended)
- ✅ Netlify
- ✅ AWS Amplify
- ✅ Azure Static Web Apps
- ✅ Self-hosted (Docker)

---

## 🎯 Key Features

### Cross-Domain Integration

**Seamless workflow across all engineering disciplines:**

- CAD ↔ PCB: 3D models → PCB enclosures
- AI ↔ Circuit: Component recommendations → schematics
- Robotics ↔ Digital Twin: Real-time synchronization
- Embedded ↔ Simulation: Code → hardware simulation

### Advanced Capabilities

**Multi-Physics Simulation:**
- Coupled thermal-electrical-mechanical analysis
- Transient and steady-state solvers
- Mesh generation and refinement
- Result visualization

**Agentic AI:**
- Autonomous design iteration
- Multi-objective optimization
- Reinforcement learning agents
- Predictive analytics

**Digital Twin:**
- Real-time synchronization
- Sensor data integration
- Predictive maintenance
- Performance monitoring

---

## 🔒 Security & Compliance

### Security Measures
- ✅ Authentication and authorization (Supabase Auth)
- ✅ Row-level security (RLS)
- ✅ Input validation and sanitization
- ✅ XSS/CSRF protection
- ✅ Secure plugin execution (sandboxing)
- ✅ Encrypted data storage
- ✅ Role-based access control (RBAC)

### Dependency audits
- ✅ Production dependencies (`npm audit --omit=dev`): **0 vulnerabilities**
- 🟡 Full tree (`npm audit`): 12 vulnerabilities (2 critical, 6 high, 4 moderate), all in the dev toolchain — vitest/tinypool/vite-node, vite/esbuild, and tailwindcss with its transitive braces/chokidar/micromatch/fast-glob/postcss deps. None of these ship to production.
- Every remaining fix requires a semver-major upgrade (vitest 4, vite 8, tailwindcss 4); those are tracked as deliberate migrations rather than blind lockfile bumps.

### Compliance
- ✅ GDPR compliance ready
- ✅ IEC 62443 support (industrial IoT)
- ✅ ISO 27001 security controls
- ✅ WCAG 2.1 AA accessibility (partial)

---

## ⚡ Performance

### Runtime Performance (design targets)
- Initial Load: < 3 seconds
- Time to Interactive: < 5 seconds
- Frame Rate: 60 FPS (3D rendering)
- Memory Usage: < 200 MB (typical)
- Simulation Speed: Real-time capable

### Scalability (design targets)
- Max Components: 10,000+ per schematic
- Max Concurrent Users: 50+ (collaboration)
- Max Project Size: 100+ MB
- Cloud Sync: Real-time (< 100ms latency)

---

## 🤝 Contributing

We welcome contributions! To contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📚 Documentation

### Available Documentation
- `README.md` - This file (user guide)
- `FEATURES.md` - Detailed feature documentation
- `.env.example` - Environment configuration

---

## 🎓 Target Users

- **Professional Engineers** - Electrical, mechanical, robotics engineers
- **Research & Development** - Academic researchers and R&D teams
- **Industrial Applications** - Manufacturing automation and IIoT
- **Educational Institutions** - Universities and technical schools
- **Hobbyists & Makers** - Electronics enthusiasts and makers

---

## 🆘 Support

- 🐛 **Issues:** [GitHub Issues](https://github.com/Ancillary-AGI/folio/issues)

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🎉 Status

**Folio is under active development; the core workbench is operational and covered by CI.**

Domain features implemented and exercised by the test suite:
- ✅ CAD & Mechanical Design with FEA
- ✅ Circuit & PCB Design with advanced analysis
- ✅ Robotics & Embedded Systems with digital twin
- ✅ Agentic AI with autonomous optimization
- ✅ IDE & Collaboration with real-time editing

Every push runs lint, typechecks, 311 unit/integration tests, and a production build (see `.github/workflows/ci.yml`).

---

**Version:** 2.0.0  
**Status:** 🚧 Active development  
**Build:** ✅ Passing (local + CI)  
**Deploy:** ⚙️ Static build ready for Vercel/Netlify/self-host

---

*Built with ❤️ for the engineering community* ⚡🔧🤖
