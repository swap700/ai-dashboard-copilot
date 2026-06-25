import { forwardRef, useEffect, useRef, useState } from 'react'
import { motion, useScroll, useTransform, useMotionValueEvent } from 'framer-motion'

const APP_URL = 'https://nixara-app.vercel.app'

/* ── Reveal helpers ───────────────────────── */
const fadeUp = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
}
const fadeLeft = {
  hidden: { opacity: 0, x: -45 },
  show: { opacity: 1, x: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
}
const fadeRight = {
  hidden: { opacity: 0, x: 45 },
  show: { opacity: 1, x: 0, transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] } },
}
const stagger = (delay = 0.12) => ({
  hidden: {},
  show: { transition: { staggerChildren: delay } },
})

const Reveal = forwardRef(function Reveal(
  { as: Tag = motion.div, variants = fadeUp, className, children, style, ...rest },
  ref
) {
  return (
    <Tag
      ref={ref}
      className={className}
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.25 }}
      variants={variants}
      {...rest}
    >
      {children}
    </Tag>
  )
})

/* ── Scroll progress bar ───────────────────────── */
function ScrollProgressBar() {
  const { scrollYProgress } = useScroll()
  return <motion.div className="scroll-progress" style={{ scaleX: scrollYProgress }} />
}

/* ── Parallax wrapper — offsets children vertically as the section
   travels through the viewport, for a depth effect on scroll ── */
function Parallax({ children, range = [60, -60], className, style }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], range)
  return (
    <motion.div ref={ref} className={className} style={{ ...style, y }}>
      {children}
    </motion.div>
  )
}

/* ── Word-by-word headline reveal ───────────────────────── */
function WordReveal({ text, className, delayStart = 0, stagger: gap = 0.05 }) {
  const words = text.split(' ')
  return (
    <span style={{ display: 'inline-block' }}>
      {words.map((w, i) => (
        <span key={i} style={{ display: 'inline-block', overflow: 'hidden', marginRight: '0.28em' }}>
          <motion.span
            className={className}
            style={{ display: 'inline-block' }}
            initial={{ y: '110%' }}
            animate={{ y: '0%' }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: delayStart + i * gap }}
          >
            {w}
          </motion.span>
        </span>
      ))}
    </span>
  )
}


/* ── Scramble stat ───────────────────────── */
const NUMS = '0123456789'
const MIX = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function ScrambleStat({ value, delay }) {
  const [text, setText] = useState('')
  const [state, setState] = useState('idle')

  useEffect(() => {
    let raf
    const timeout = setTimeout(() => {
      setState('active')
      let frame = 0
      const FRAMES = 24
      const id = setInterval(() => {
        frame++
        const locked = Math.floor((frame / FRAMES) * value.length)
        setText(
          value
            .split('')
            .map((ch, i) => {
              if (i < locked) return ch
              if (ch === ' ') return ' '
              const pool = /\d/.test(ch) ? NUMS : MIX
              return pool[Math.floor(Math.random() * pool.length)]
            })
            .join('')
        )
        if (frame >= FRAMES) {
          clearInterval(id)
          setText(value)
          setState('done')
        }
      }, 38)
      return () => clearInterval(id)
    }, delay)
    return () => clearTimeout(timeout)
  }, [value, delay])

  return (
    <div className={`hs-n${state === 'active' ? ' sc-active' : ''}${state === 'done' ? ' sc-done' : ''}`}>
      {text || ' '}
    </div>
  )
}

function TypeLabel() {
  const [text, setText] = useState('')
  const full = 'running analysis...'
  const done = 'analysis complete.'
  const [phase, setPhase] = useState('typing')

  useEffect(() => {
    let i = 0
    const start = setTimeout(() => {
      const id = setInterval(() => {
        i++
        setText(full.slice(0, i))
        if (i >= full.length) {
          clearInterval(id)
          const STATS = 4
          const totalDelay = STATS * 280 + 900
          setTimeout(() => {
            setPhase('switching')
            setTimeout(() => {
              setText(done)
              setPhase('done')
            }, 260)
          }, totalDelay)
        }
      }, 55)
    }, 900)
    return () => clearTimeout(start)
  }, [])

  return (
    <span id="stats-label" style={{ opacity: phase === 'switching' ? 0 : 1, transition: 'opacity .25s' }}>
      {text}
    </span>
  )
}

/* ── Hero ───────────────────────── */
function Hero() {
  const heroVars = stagger(0.12)
  const heroRef = useRef(null)
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] })
  const visY = useTransform(scrollYProgress, [0, 1], [0, 140])
  const visScale = useTransform(scrollYProgress, [0, 1], [1, 0.92])
  const visRotate = useTransform(scrollYProgress, [0, 1], [0, 3])
  const heroOpacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])

  return (
    <div id="hero" className="z1" ref={heroRef}>
      <motion.div className="hero-text" initial="hidden" animate="show" variants={heroVars} style={{ opacity: heroOpacity }}>
        <motion.div className="hero-eye" variants={fadeUp}>
          <span className="eye-dot"></span>AI Dashboard Copilot
        </motion.div>

        <h1>
          <WordReveal text="Stop reading" delayStart={0.15} />
          <br />
          <WordReveal text="dashboards." delayStart={0.3} />
          <br />
          <WordReveal text="Start deciding." delayStart={0.45} className="h1-c" />
        </h1>

        <motion.p className="hero-sub" variants={fadeUp}>
          Upload a dataset, ask a question — get an executive-grade report tailored to your role, with every decision tracked.
        </motion.p>

        <motion.div className="hero-btns" variants={fadeUp}>
          <a href={APP_URL} target="_blank" rel="noreferrer" className="btn-p">
            Try it free
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </a>
          <a href="#how" className="btn-g">See how it works</a>
        </motion.div>

        <motion.div className="hero-stats" variants={fadeUp}>
          <div className="stats-header">
            <span className="stats-cursor"></span>
            <TypeLabel />
          </div>
          <div className="stats-row">
            <div className="hs"><ScrambleStat value="60s" delay={1955} /></div>
            <div className="hs"><ScrambleStat value="6 roles" delay={2235} /></div>
            <div className="hs"><ScrambleStat value="3 formats" delay={2515} /></div>
            <div className="hs"><ScrambleStat value="Free" delay={2795} /></div>
          </div>
        </motion.div>
      </motion.div>

      <motion.div
        className="hero-vis"
        initial="hidden"
        animate="show"
        variants={fadeRight}
        transition={{ delay: 0.3 }}
        style={{ y: visY, scale: visScale, rotate: visRotate }}
      >
        <FloatingCard className="fc fc-1" label="Decision ID" value="#2,847" sub="Approved this week" y={[0, -9, 0]} duration={5} />
        <FloatingCard className="fc fc-2" label="AI Accuracy" value="91%" sub="Across tracked outcomes" y={[0, 7, 0]} duration={6.5} />
        <div className="mock">
          <div className="mock-bar">
            <div className="mock-bar-dot mbd-r"></div>
            <div className="mock-bar-dot mbd-y"></div>
            <div className="mock-bar-dot mbd-g"></div>
            <div className="mock-bar-t">Nixara · Executive Summary</div>
          </div>
          <div className="mock-inner">
            <div className="mock-top">
              <div className="mock-sect">Q3 Revenue Analysis</div>
              <div className="mock-rbadge">CFO View</div>
            </div>
            <div className="mock-q">"Should we accelerate West Coast expansion into Q4 given current pipeline velocity?"</div>
            <div className="sp-track"><div className="sp-bar"></div></div>
            <div className="mock-card">
              <div className="mc-head">⚡ Key Finding</div>
              <div className="mc-body">Pipeline coverage at 3.2× supports accelerated timeline. West Coast deals close 18% faster than national average — proceed with budget reallocation.</div>
            </div>
            <div className="mock-nums">
              <div className="mn"><div className="mn-v up">+23%</div><div className="mn-l">Pipeline MoM</div></div>
              <div className="mn"><div className="mn-v neu">3.2×</div><div className="mn-l">Coverage</div></div>
              <div className="mn"><div className="mn-v up">$4.1M</div><div className="mn-l">Projected</div></div>
            </div>
            <div className="mock-decisions">
              <div className="md md-a">✓ Approve</div>
              <div className="md md-r">✕ Reject</div>
              <div className="md md-p">◷ Postpone</div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

function FloatingCard({ className, label, value, sub, y, duration }) {
  return (
    <motion.div
      className={className}
      animate={{ y }}
      transition={{ duration, repeat: Infinity, ease: 'easeInOut' }}
    >
      <div className="fc-l">{label}</div>
      <div className="fc-v">{value}</div>
      <div className="fc-s">{sub}</div>
    </motion.div>
  )
}

/* ── Cinematic interstitial (inspired by full-bleed editorial reels) ── */
function Cinematic({ tag, line1, line2, sub }) {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.85, 1, 0.85])
  const opacity = useTransform(scrollYProgress, [0, 0.25, 0.75, 1], [0.3, 1, 1, 0.3])
  const line1X = useTransform(scrollYProgress, [0, 1], [-60, 60])
  const line2X = useTransform(scrollYProgress, [0, 1], [60, -60])
  const bgScale = useTransform(scrollYProgress, [0, 0.5, 1], [1.15, 1, 1.15])

  return (
    <section className="cine z1" ref={ref}>
      <motion.div className="cine-bg" style={{ scale: bgScale }}></motion.div>
      <motion.div style={{ scale, opacity }}>
        <div className="cine-tag">{tag}</div>
        <h2 className="cine-h">
          <motion.span style={{ display: 'inline-block', x: line1X }}>{line1}</motion.span>
          <br />
          <motion.span className="dim" style={{ display: 'inline-block', x: line2X }}>{line2}</motion.span>
        </h2>
        {sub && <p className="cine-sub">{sub}</p>}
      </motion.div>
    </section>
  )
}

/* ── How it works ───────────────────────── */
const STEPS = [
  { n: 1, label: 'Upload', ico: '📂', h: 'Upload your data', p: 'CSV, Excel, or a live Tableau connection. Nixara handles messy data automatically.' },
  { n: 2, label: 'Ask', ico: '💬', h: 'Ask your question', p: 'Plain language, your role, your time horizon. No query language, no pivot tables.' },
  { n: 3, label: 'Decide', ico: '⚡', h: 'Decide & track', p: 'Three AI reports in under 60 seconds. Approve, reject, or postpone — then track the outcome.' },
]

function Step({ s, i }) {
  return (
    <motion.div
      className="step"
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.5 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: i * 0.2 }}
    >
      <div className="step-n">
        <motion.div
          className="step-circle"
          initial={{ scale: 0.6, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true, amount: 0.5 }}
          transition={{ duration: 0.4, delay: i * 0.2 + 0.15 }}
        >
          {s.n}
        </motion.div>
        {s.label}
      </div>
      <motion.div
        className="step-ico"
        initial={{ scale: 0, rotate: -8 }}
        whileInView={{ scale: 1, rotate: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.5, ease: 'backOut', delay: i * 0.2 + 0.25 }}
      >
        {s.ico}
      </motion.div>
      <h3 className="step-h">{s.h}</h3>
      <p className="step-p">{s.p}</p>
    </motion.div>
  )
}

function HowItWorks() {
  return (
    <section id="how" className="z1">
      <div className="inner" style={{ maxWidth: 1200, margin: '0 auto', padding: '6.5rem 0' }}>
        <Reveal>
          <div className="sec-eye">How it works</div>
          <h2 className="sec-h">Three steps from raw data<br />to boardroom-ready decision.</h2>
        </Reveal>
        <div className="steps" style={{ marginTop: '3.5rem' }}>
          {STEPS.map((s, i) => <Step key={s.n} s={s} i={i} />)}
        </div>
      </div>
    </section>
  )
}

/* ── Feature 1 ───────────────────────── */
function FeatureRoles() {
  const cards = [
    {
      id: 'cfo', role: 'CFO View', ts: 'Q3 · Cash flow risk',
      insight: '"Cash runway concern: Q3 burn rate exceeds projections by 18%. Cost review required before approving expansion budget."',
      metrics: [['-18%', 'vs Forecast', '#F87171'], ['8.2mo', 'Runway'], ['Review', 'Action', '#FBBD24']],
    },
    {
      id: 'ceo', role: 'CEO View', ts: 'Q3 · Market opportunity',
      insight: '"Expansion signals are strong. West Coast pipeline closes 18% faster than national average — this is the window to move aggressively."',
      metrics: [['+23%', 'Pipeline', '#34D399'], ['3.2×', 'Coverage'], ['Expand', 'Action', '#34D399']],
    },
    {
      id: 'coo', role: 'COO View', ts: 'Q3 · Operational readiness',
      insight: '"Current headcount supports 40% capacity increase. Expansion viable only if 6 senior hires are completed by Oct 15 — bottleneck identified."',
      metrics: [['40%', 'Capacity Left'], ['6 hires', 'Needed', '#FBBD24'], ['Oct 15', 'Deadline', '#FBBD24']],
    },
  ]
  const sectionRef = useRef(null)
  const [active, setActive] = useState(0)
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start 0.7', 'end 0.3'] })
  const activeMV = useTransform(scrollYProgress, [0, 0.34, 0.67, 1], [0, 1, 2, 2])
  useMotionValueEvent(activeMV, 'change', (v) => setActive(Math.round(v)))

  return (
    <section className="feat feat-1 z1" ref={sectionRef}>
      <div className="feat-inner">
        <Reveal variants={fadeLeft} className="feat-copy">
          <div className="feat-tag">Intelligence Layer</div>
          <h2 className="feat-h">Same data.<br />Completely different insight.</h2>
          <p className="feat-p">A CFO and a CEO need different intelligence from the same dataset. Nixara recalibrates by role — never generic.</p>
          <div className="role-tabs">
            {cards.map((c, i) => (
              <button key={c.id} className={`role-tab${i === active ? ' active' : ''}`} type="button" tabIndex={-1}>
                {c.role.replace(' View', '')}
              </button>
            ))}
          </div>
        </Reveal>
        <Parallax range={[40, -40]}>
          <div className="role-split">
            {cards.map((c, i) => (
              <motion.div
                key={c.id}
                className={`role-card${i === active ? ' active' : ''}`}
                initial={{ opacity: 0, x: 40, scale: 0.95 }}
                whileInView={{ opacity: 0.55, x: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.6, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                animate={{ scale: i === active ? 1 : 0.95, opacity: i === active ? 1 : 0.55 }}
              >
                <div className="rc-top">
                  <div className={`rc-role ${c.id}`}>{c.role}</div>
                  <div className="rc-ts">{c.ts}</div>
                </div>
                <div className="rc-insight">{c.insight}</div>
                <div className="rc-metric">
                  {c.metrics.map(([v, l, color], i2) => (
                    <div className="rcm" key={i2}>
                      <div className="rcm-v" style={color ? { color } : undefined}>{v}</div>
                      <div className="rcm-l">{l}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </Parallax>
      </div>
    </section>
  )
}

/* ── Feature 2 ───────────────────────── */
function FeatureDecisions() {
  const rows = [
    { type: 'app', q: 'Accelerate West Coast expansion into Q4', sub: 'CFO · Executive Summary · Oct 12', badge: 'Approved', id: '#2847' },
    { type: 'rej', q: 'Hire 12 additional SDRs this quarter', sub: 'Sales Lead · Operational Detail · Oct 14', badge: 'Rejected', id: '#2848' },
    { type: 'pos', q: 'Raise enterprise pricing by 15% in Q1', sub: 'Board · Risk Report · Oct 16', badge: 'Postponed', id: '#2849' },
    { type: 'app', q: 'Consolidate East Coast fulfillment hubs', sub: 'COO · Operational Detail · Oct 18', badge: 'Approved', id: '#2850' },
  ]
  return (
    <section className="feat feat-2 z1">
      <div className="feat-inner rev">
        <Reveal variants={fadeRight} className="feat-copy">
          <div className="feat-tag">Accountability</div>
          <h2 className="feat-h">Every call, logged.<br />Every outcome, tracked.</h2>
          <p className="feat-p">Approve, reject, or postpone — every call gets a unique ID and an auditable trail of what you acted on, and when.</p>
          <div className="feat-note">Unique ID per decision →</div>
        </Reveal>
        <Parallax range={[-40, 40]}>
          <motion.div
            className="decision-flow"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.3 }}
            variants={stagger(0.15)}
          >
            {rows.map((r, i) => (
              <motion.div
                key={i}
                className={`df-row ${r.type}`}
                variants={{ hidden: { opacity: 0, x: -30, scale: 0.96 }, show: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.55, ease: 'easeOut' } } }}
                whileHover={{ x: 6 }}
              >
                <div className="df-meta">
                  <div className="df-q">{r.q}</div>
                  <div className="df-sub">{r.sub}</div>
                </div>
                <div>
                  <div className={`df-badge ${r.type}`}>{r.badge}</div>
                  <div className="df-id">{r.id}</div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </Parallax>
      </div>
    </section>
  )
}

/* ── Feature 3 ───────────────────────── */
function OutcomeBar({ name, delta, pct, color }) {
  const ref = useRef(null)
  return (
    <div className="ov-metric" ref={ref}>
      <div className="ovm-top">
        <div className="ovm-name">{name}</div>
        <div className="ovm-delta">{delta}</div>
      </div>
      <div className="ovm-track">
        <motion.div
          className={`ovm-bar${color === 'c' ? ' c' : ''}`}
          style={color && color !== 'c' ? { background: color } : undefined}
          initial={{ width: '0%' }}
          whileInView={{ width: `${pct}%` }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.2 }}
        />
      </div>
    </div>
  )
}

function FeatureOutcomes() {
  return (
    <section className="feat feat-3 z1">
      <div className="feat-inner">
        <Reveal variants={fadeLeft} className="feat-copy">
          <div className="feat-tag">Intelligence Loop</div>
          <h2 className="feat-h">Was Nixara right?<br />Now you'll know.</h2>
          <p className="feat-p">Log what actually happened. Nixara builds an accuracy record across every role and report type.</p>
          <div className="feat-note">Live in Phase 2 →</div>
        </Reveal>
        <Parallax range={[40, -40]}>
          <Reveal variants={fadeRight} className="outcome-vis">
            <div className="ov-head">
              <div className="ov-title">Outcome Report · Decision #2847</div>
              <div className="ov-acc">91% accuracy</div>
            </div>
            <OutcomeBar name="West Coast Pipeline Revenue" delta="+$3.9M actual vs +$4.1M projected" pct={95} />
            <OutcomeBar name="Deal Close Velocity" delta="+21% vs +18% predicted" pct={100} color="c" />
            <OutcomeBar name="Headcount Readiness" delta="5 of 6 hires completed by deadline" pct={83} color="linear-gradient(90deg,#FBBD24,#FDE68A)" />
            <div className="ov-verdict">
              <div className="ov-ico">✅</div>
              <div><strong>Outcome: Exceeded</strong> — Nixara's recommendation delivered 95% of projected upside. CFO risk flag was overcautious.</div>
            </div>
          </Reveal>
        </Parallax>
      </div>
    </section>
  )
}

/* ── Feature 4 ───────────────────────── */
function FeatureReports() {
  return (
    <section className="feat feat-4 z1">
      <div className="feat-inner rev">
        <Reveal variants={fadeRight} className="feat-copy">
          <div className="feat-tag">Output &amp; Access</div>
          <h2 className="feat-h">Three report formats.<br />Zero friction to start.</h2>
          <p className="feat-p">Three formats, generated together, exportable as Word or PDF. Your first three reports are free — no account needed.</p>
          <div className="feat-note">3 formats · Word + PDF export →</div>
        </Reveal>
        <Parallax range={[-30, 30]}>
          <Reveal variants={stagger(0.1)} className="feat4-grid">
            <motion.div className="f4c" variants={fadeUp} whileHover={{ y: -4 }}>
              <div className="f4c-ico">📄</div>
              <div className="f4c-h">Three formats, one click</div>
              <div className="f4c-p">Generated simultaneously for every analysis.</div>
              <div className="report-types">
                <div className="rt">Executive Summary</div>
                <div className="rt">Operational Detail</div>
                <div className="rt">Risk Report</div>
              </div>
            </motion.div>
            <motion.div className="f4c" variants={fadeUp} whileHover={{ y: -4 }}>
              <div className="f4c-big">3</div>
              <div className="f4c-h">Free reports per session</div>
              <div className="f4c-p">No API key required. Paste your own for unlimited access — it never leaves your browser.</div>
            </motion.div>
            <motion.div className="f4c" variants={fadeUp} whileHover={{ y: -4 }}>
              <div className="f4c-ico">🔗</div>
              <div className="f4c-h">Live Tableau connector</div>
              <div className="f4c-p">Reads your live Tableau published view directly. No CSV export. No manual refresh.</div>
            </motion.div>
            <motion.div className="f4c" variants={fadeUp} whileHover={{ y: -4 }}>
              <div className="f4c-ico">↓</div>
              <div className="f4c-h">Word &amp; PDF export</div>
              <div className="f4c-p">Download any report as .docx or PDF. Ready to paste into a board deck immediately.</div>
            </motion.div>
          </Reveal>
        </Parallax>
      </div>
    </section>
  )
}

/* ── About ───────────────────────── */
function About() {
  return (
    <section id="about" className="z1">
      <Reveal as={motion.div} className="inner" style={{ maxWidth: 760, margin: '0 auto', padding: '6rem 0', textAlign: 'center' }}>
        <div className="sec-eye center" style={{ justifyContent: 'center' }}>Built by</div>
        <div className="ab-av">S</div>
        <div className="ab-name">Swapnil S.</div>
        <div className="ab-role">AI Application Developer</div>
        <p className="ab-bio">
          A production AI application — real analytics, live data, tracked decisions. Prompt engineering, database design, and UX, working as one.
        </p>
        <div className="ab-links">
          <a href="https://www.linkedin.com/in/swapnil-sakorkar" target="_blank" rel="noreferrer" className="al">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z" /><circle cx="4" cy="4" r="2" /></svg>
            LinkedIn
          </a>
          <a href={APP_URL} target="_blank" rel="noreferrer" className="al">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20" /></svg>
            Live App
          </a>
        </div>
      </Reveal>
    </section>
  )
}

/* ── CTA ───────────────────────── */
function CTA() {
  return (
    <div className="cta z1">
      <Reveal>
        <div className="sec-eye center" style={{ justifyContent: 'center', marginBottom: '.85rem' }}>Live now · no signup required</div>
        <div className="cta-h">Try Nixara free, right now.</div>
        <p className="cta-p">No API key. No account. Your first 3 reports are on us.</p>
        <a href={APP_URL} target="_blank" rel="noreferrer" className="btn-p" style={{ margin: '0 auto', width: 'fit-content', fontSize: '.87rem', padding: '.85rem 2.25rem' }}>
          Open Nixara
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
        </a>
      </Reveal>
    </div>
  )
}

/* ── Nav / Footer ───────────────────────── */
function Nav() {
  return (
    <nav className="z1">
      <div className="logo"><span className="logo-beacon"></span>Nixara</div>
      <div className="nav-r">
        <a href="#how" className="nl">How it works</a>
        <a href="#features" className="nl">Features</a>
        <a href="#about" className="nl">About</a>
        <a href={APP_URL} target="_blank" rel="noreferrer" className="nc">Try free</a>
      </div>
    </nav>
  )
}

function Footer() {
  return (
    <footer className="z1">
      <span>© 2026 Nixara · Swapnil S.</span>
      <div className="fl">
        <a href={APP_URL} target="_blank" rel="noreferrer">Live App</a>
        <a href="https://www.linkedin.com/in/swapnil-sakorkar" target="_blank" rel="noreferrer">LinkedIn</a>
      </div>
    </footer>
  )
}

function App() {
  return (
    <>
      <ScrollProgressBar />
      <div id="bg"></div>
      <Nav />
      <Hero />

      <div className="hr z1"></div>
      <HowItWorks />

      <Cinematic
        tag="Built for decisions, not dashboards"
        line1="Insight in seconds."
        line2="Action for years."
        sub="Every report Nixara generates becomes a tracked decision — and every tracked decision becomes proof of whether the AI was right."
      />

      <div className="hr z1"></div>
      <div id="features"></div>
      <FeatureRoles />
      <div className="hr z1"></div>
      <FeatureDecisions />
      <div className="hr z1"></div>
      <FeatureOutcomes />
      <div className="hr z1"></div>
      <FeatureReports />

      <div className="hr z1"></div>
      <About />
      <CTA />
      <Footer />
    </>
  )
}

export default App
