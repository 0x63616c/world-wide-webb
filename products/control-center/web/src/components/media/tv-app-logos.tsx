/**
 * tv-app-logos , brand-mark lookup for Apple TV apps (www-0z4f).
 *
 * The design renders each app as its real, full-color brand mark (YouTube play
 * box, Netflix "N", Prime/Hulu/Disney+ wordmarks, …) rather than a grey letter
 * avatar. App names arrive verbatim from Home Assistant's `source_list`, so we
 * normalise the name and look up a hand-built mark; anything we don't have a
 * mark for falls back to a tasteful 2-letter monospace glyph (NOT fake data ,
 * a deterministic typographic stand-in derived from the real app name).
 *
 * Shared by TvAppsTileView (tile) and AllAppsModal so both stay consistent.
 */

import type { ReactNode } from "react";

// ── Brand registry ──────────────────────────────────────────────────────────

interface Brand {
  /** Background fill for the logo plate (brand-accurate where it reads better). */
  bg: string;
  /** Renders the mark at the given square size. */
  render: (size: number) => ReactNode;
}

/** Lowercased, alphanumeric-only key so "Disney+", "Prime Video" etc. resolve. */
function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A centered colored wordmark (used for text-style brand marks). */
function wordmark(text: string, color: string, size: number, italic = false): ReactNode {
  return (
    <span
      style={{
        fontFamily: "var(--ui)",
        fontWeight: 800,
        fontSize: size * 0.34,
        lineHeight: 1,
        letterSpacing: "-0.03em",
        color,
        fontStyle: italic ? "italic" : "normal",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

// Aliases map the various source_list spellings onto one brand key.
const ALIASES: Record<string, string> = {
  primevideo: "prime",
  amazonprimevideo: "prime",
  appletv: "appletv",
  appletvplus: "appletv",
  tv: "appletv",
  disneyplus: "disney",
  hbomax: "max",
  spotifymusic: "spotify",
};

const BRANDS: Record<string, Brand> = {
  youtube: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#FF0000"
          d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.872.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12z"
        />
      </svg>
    ),
  },
  netflix: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s * 0.62} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#E50914"
          d="M5.398 0v.006c3.028 8.556 5.37 15.175 8.348 23.596 2.344.058 4.85.398 4.854.398-2.8-7.924-5.923-16.747-8.487-24zm8.489 0v9.63L18.6 22.951c-.043-7.86-.004-15.913.002-22.95zM5.398 1.05V24c1.873-.225 2.81-.312 4.715-.398v-9.22z"
        />
      </svg>
    ),
  },
  prime: {
    bg: "#0a0a0a",
    render: (s) => (
      <span
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          gap: s * 0.04,
        }}
      >
        {wordmark("prime", "#ffffff", s * 1.18)}
        <svg width={s * 0.5} height={s * 0.14} viewBox="0 0 40 11" aria-hidden="true">
          <path
            d="M2 3c8 6 28 6 36 0"
            fill="none"
            stroke="#00A8E1"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path d="M33 1l5 2-3 4z" fill="#00A8E1" />
        </svg>
      </span>
    ),
  },
  disney: {
    bg: "#0a0a0a",
    render: (s) => (
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: s * 0.02 }}>
        {wordmark("Disney", "#1f8bf4", s * 1.05, true)}
        <span
          style={{
            fontFamily: "var(--ui)",
            fontWeight: 700,
            fontSize: s * 0.26,
            color: "#1f8bf4",
            verticalAlign: "super",
          }}
        >
          +
        </span>
      </span>
    ),
  },
  hulu: {
    bg: "#0a0a0a",
    render: (s) => wordmark("hulu", "#1CE783", s * 1.25),
  },
  appletv: {
    bg: "#0a0a0a",
    render: (s) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: s * 0.04 }}>
        <svg width={s * 0.42} height={s * 0.5} viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#ffffff"
            d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z"
          />
        </svg>
        {wordmark("tv", "#ffffff", s * 0.92)}
      </span>
    ),
  },
  spotify: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#1DB954"
          d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141 4.32-1.32 9.72-.66 13.44 1.62.361.181.54.78.301 1.201zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.56.3z"
        />
      </svg>
    ),
  },
  max: {
    bg: "#0a0a0a",
    render: (s) => wordmark("max", "#0046ff", s * 1.2),
  },
  paramount: {
    bg: "#0a0a0a",
    render: (s) => wordmark("P+", "#0064ff", s * 1.1),
  },
  peacock: {
    bg: "#0a0a0a",
    render: (s) => wordmark("peacock", "#ffffff", s * 0.95),
  },
  // ── www-rii3: full prod source_list coverage ───────────────────────────────
  // SVG paths below are Simple Icons glyphs (CC0) where the brand exists there;
  // Apple system apps aren't in Simple Icons, so those are hand-drawn
  // approximations of the tvOS icons in the same flat style.
  twitch: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#9146FF"
          d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"
        />
      </svg>
    ),
  },
  vlc: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#FF8800"
          d="M12.0319 0c-.8823 0-1.0545.136-1.0545.136-.1738.056-.3556.255-.4105.43L9.683 3.3808c.4729.1729 1.3222.4266 2.2337.4266 1.0987 0 2.017-.3494 2.3763-.5075L13.4352.566c-.055-.1755-.237-.3707-.4067-.4374 0 0-.1142-.1286-.9966-.1286zm3.5645 7.455c-.3601.34-1.3276.9373-3.6797.9373-2.2929 0-3.189-.5678-3.5213-.9113l-1.3887 4.4227c.2272.3614 1.2539 1.5594 4.8847 1.5594 3.7569 0 4.8539-1.3467 5.0649-1.6737zm-8.5897 4.4487l-1.0025 3.1922H4.3428c-.2486 0-.5097.1932-.5826.4315l-2.334 7.6317a.3962.3962 0 0 0-.0169.1537c-.0008.0053-.002.0099-.002.016 0 .0839.0233.226.0233.226.0322.2456.2612.4452.5098.4452h20.1192c.2487 0 .4768-.1994.5098-.4453 0 0 .0234-.142.0234-.226a.0245.0245 0 0 0-.0025-.01.3201.3201 0 0 0 .0024-.0313.4096.4096 0 0 0-.019-.1282l-2.3339-7.6318c-.0729-.2383-.334-.4314-.5826-.4314h-1.6636l.2005.6391c-.2407.4854-1.4886 2.38-6.3027 2.38-4.6003 0-5.8288-1.73-6.1107-2.3072z"
        />
      </svg>
    ),
  },
  cnn: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#CC0000"
          d="M23.9962 15.514c0 2.0638-2.6676 3.0547-4.0789.6576-.1012-.173-2.3252-4.0032-2.3252-4.0032v3.3457c0 2.0637-2.6663 3.0546-4.0776.6575-.1025-.173-2.3253-4.0032-2.3253-4.0032v3.1547c0 1.4318-.8498 2.2073-2.1791 2.2073H5.5299a5.5299 5.5299 0 010-11.0598h1.7946v1.328H5.5299a4.2019 4.2019 0 100 8.4038h3.4494a.8973.8973 0 00.8794-.878V8.524a.2692.2692 0 01.1935-.273c.141-.0384.2897.0487.3987.2333l2.1522 3.7084c1.251 2.1573 2.0728 3.5738 2.083 3.5892.2807.4742.6986.5576.9973.4755a.7973.7973 0 00.582-.787v-6.945a.2705.2705 0 01.191-.2744c.1397-.0384.287.0487.3947.2333l1.9946 3.4366 2.242 3.8648c.2191.3717.5242.5038.7896.5038a.7691.7691 0 00.2063-.0282.7986.7986 0 00.591-.791V6.4707H24zM8.0026 13.9695V8.4857c0-2.0638 2.6675-3.0546 4.0788-.6563.1025.173 2.3253 4.002 2.3253 4.002V8.4856c0-2.0638 2.6662-3.0546 4.0775-.6563.1026.173 2.3253 4.002 2.3253 4.002V6.4705H22.14v8.9999a.2705.2705 0 01-.1935.2743c-.141.0384-.2897-.0487-.3987-.2333a1360.4277 1360.4277 0 01-2.2406-3.8622l-1.9946-3.434c-.2794-.4744-.696-.5577-.9921-.477a.7986.7986 0 00-.5833.7858v6.9464a.2718.2718 0 01-.1935.2743c-.1423.0384-.291-.0487-.3987-.2333-.0192-.032-1.069-1.8407-2.083-3.5892a6211.7971 6211.7971 0 00-2.1535-3.711c-.2794-.4755-.6973-.5575-.996-.4768a.7999.7999 0 00-.5845.7858v6.8002a.3717.3717 0 01-.3487.3474h-3.452a3.6712 3.6712 0 010-7.3424H7.322v1.328H5.5427a2.3432 2.3432 0 100 4.6864H7.636a.364.364 0 00.3666-.3705Z"
        />
      </svg>
    ),
  },
  appstore: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#0D96F6"
          d="M8.8086 14.9194l6.1107-11.0368c.0837-.1513.1682-.302.2437-.4584.0685-.142.1267-.2854.1646-.4403.0803-.3259.0588-.6656-.066-.9767-.1238-.3095-.3417-.5678-.6201-.7355a1.4175 1.4175 0 0 0-.921-.1924c-.3207.043-.6135.1935-.8443.4288-.1094.1118-.1996.2361-.2832.369-.092.1463-.175.2979-.259.4492l-.3864.6979-.3865-.6979c-.0837-.1515-.1667-.303-.2587-.4492-.0837-.1329-.1739-.2572-.2835-.369-.2305-.2353-.5233-.3857-.844-.429a1.4181 1.4181 0 0 0-.921.1926c-.2784.1677-.4964.426-.6203.7355-.1246.311-.1461.6508-.066.9767.038.155.0962.2984.1648.4403.0753.1564.1598.307.2437.4584l1.248 2.2543-4.8625 8.7825H2.0295c-.1676 0-.3351-.0007-.5026.0092-.1522.009-.3004.0284-.448.0714-.3108.0906-.5822.2798-.7783.548-.195.2665-.3006.5929-.3006.9279 0 .3352.1057.6612.3006.9277.196.2683.4675.4575.7782.548.1477.043.296.0623.4481.0715.1675.01.335.009.5026.009h13.0974c.0171-.0357.059-.1294.1-.2697.415-1.4151-.6156-2.843-2.0347-2.843zM3.113 18.5418l-.7922 1.5008c-.0818.1553-.1644.31-.2384.4705-.067.1458-.124.293-.1611.452-.0785.3346-.0576.6834.0645 1.0029.1212.3175.3346.583.607.7549.2727.172.5891.2416.9013.1975.3139-.044.6005-.1986.8263-.4402.1072-.1148.1954-.2424.2772-.3787.0902-.1503.1714-.3059.2535-.4612L6 19.4636c-.0896-.149-.9473-1.4704-2.887-.9218m20.5861-3.0056a1.4707 1.4707 0 0 0-.779-.5407c-.1476-.0425-.2961-.0616-.4483-.0705-.1678-.0099-.3352-.0091-.503-.0091H18.648l-4.3891-7.817c-.6655.7005-.9632 1.485-1.0773 2.1976-.1655 1.0333.0367 2.0934.546 3.0004l5.2741 9.3933c.084.1494.167.299.2591.4435.0837.131.1739.2537.2836.364.231.2323.5238.3809.8449.4232.3192.0424.643-.0244.9217-.1899.2784-.1653.4968-.4204.621-.7257.1246-.3072.146-.6425.0658-.9641-.0381-.1529-.0962-.2945-.165-.4346-.0753-.1543-.1598-.303-.2438-.4524l-1.216-2.1662h1.596c.1677 0 .3351.0009.5029-.009.1522-.009.3007-.028.4483-.0705a1.4707 1.4707 0 0 0 .779-.5407A1.5386 1.5386 0 0 0 24 16.452a1.539 1.539 0 0 0-.3009-.9158Z"
        />
      </svg>
    ),
  },
  arcade: {
    // Brand glyph is black; rendered white to read on the dark plate.
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#ffffff"
          d="M.198 18.24a.966.966 0 0 1-.194-.571v-.955s0-.571.563-.313c0 0 6.919 3.135 8.033 3.626a7.832 7.832 0 0 0 3.408.729 8.216 8.216 0 0 0 3.396-.729l8.037-3.626c.559-.258.559.313.559.313v.955a1.038 1.038 0 0 1-.198.575c-.19.258-.515.539-1.411.959-.713.337-6.23 2.818-6.995 3.17a8.008 8.008 0 0 1-3.4.729 8.336 8.336 0 0 1-3.82-.927c-1.435-.65-5.849-2.631-6.567-2.972-.9-.428-1.153-.654-1.411-.963zm1.411-5.973l6.987-3.17a7.975 7.975 0 0 1 2.164-.634v5.707c0 .396.571.697 1.236.697s1.141-.313 1.141-.697V8.479c.778.105 1.54.313 2.263.618l6.987 3.17c.579.273 1.609.761 1.609 1.538s-1.011 1.236-1.609 1.53l-6.987 3.17a8.2 8.2 0 0 1-3.396.729 7.832 7.832 0 0 1-3.408-.729l-6.987-3.17C1.011 15.042 0 14.574 0 13.801s1.03-1.264 1.609-1.534zm1.807 2.247c.77.396 1.683.396 2.453 0 .682-.396.686-1.026 0-1.419a2.705 2.705 0 0 0-2.453 0c-.68.392-.666 1.02 0 1.419zM12 7.595a3.35 3.35 0 1 1 3.349-3.351v.003c0 1.849-1.5 3.348-3.349 3.348z"
        />
      </svg>
    ),
  },
  music: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#FA243C"
          d="M23.994 6.124a9.23 9.23 0 00-.24-2.19c-.317-1.31-1.062-2.31-2.18-3.043a5.022 5.022 0 00-1.877-.726 10.496 10.496 0 00-1.564-.15c-.04-.003-.083-.01-.124-.013H5.986c-.152.01-.303.017-.455.026-.747.043-1.49.123-2.193.4-1.336.53-2.3 1.452-2.865 2.78-.192.448-.292.925-.363 1.408-.056.392-.088.785-.1 1.18 0 .032-.007.062-.01.093v12.223c.01.14.017.283.027.424.05.815.154 1.624.497 2.373.65 1.42 1.738 2.353 3.234 2.801.42.127.856.187 1.293.228.555.053 1.11.06 1.667.06h11.03a12.5 12.5 0 001.57-.1c.822-.106 1.596-.35 2.295-.81a5.046 5.046 0 001.88-2.207c.186-.42.293-.87.37-1.324.113-.675.138-1.358.137-2.04-.002-3.8 0-7.595-.003-11.393zm-6.423 3.99v5.712c0 .417-.058.827-.244 1.206-.29.59-.76.962-1.388 1.14-.35.1-.706.157-1.07.173-.95.045-1.773-.6-1.943-1.536a1.88 1.88 0 011.038-2.022c.323-.16.67-.25 1.018-.324.378-.082.758-.153 1.134-.24.274-.063.457-.23.51-.516a.904.904 0 00.02-.193c0-1.815 0-3.63-.002-5.443a.725.725 0 00-.026-.185c-.04-.15-.15-.243-.304-.234-.16.01-.318.035-.475.066-.76.15-1.52.303-2.28.456l-2.325.47-1.374.278c-.016.003-.032.01-.048.013-.277.077-.377.203-.39.49-.002.042 0 .086 0 .13-.002 2.602 0 5.204-.003 7.805 0 .42-.047.836-.215 1.227-.278.64-.77 1.04-1.434 1.233-.35.1-.71.16-1.075.172-.96.036-1.755-.6-1.92-1.544-.14-.812.23-1.685 1.154-2.075.357-.15.73-.232 1.108-.31.287-.06.575-.116.86-.177.383-.083.583-.323.6-.714v-.15c0-2.96 0-5.922.002-8.882 0-.123.013-.25.042-.37.07-.285.273-.448.546-.518.255-.066.515-.112.774-.165.733-.15 1.466-.296 2.2-.444l2.27-.46c.67-.134 1.34-.27 2.01-.403.22-.043.442-.088.663-.106.31-.025.523.17.554.482.008.073.012.148.012.223.002 1.91.002 3.822 0 5.732z"
        />
      </svg>
    ),
  },
  podcasts: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#9933CC"
          d="M5.34 0A5.328 5.328 0 000 5.34v13.32A5.328 5.328 0 005.34 24h13.32A5.328 5.328 0 0024 18.66V5.34A5.328 5.328 0 0018.66 0zm6.525 2.568c2.336 0 4.448.902 6.056 2.587 1.224 1.272 1.912 2.619 2.264 4.392.12.59.12 2.2.007 2.864a8.506 8.506 0 01-3.24 5.296c-.608.46-2.096 1.261-2.336 1.261-.088 0-.096-.091-.056-.46.072-.592.144-.715.48-.856.536-.224 1.448-.874 2.008-1.435a7.644 7.644 0 002.008-3.536c.208-.824.184-2.656-.048-3.504-.728-2.696-2.928-4.792-5.624-5.352-.784-.16-2.208-.16-3 0-2.728.56-4.984 2.76-5.672 5.528-.184.752-.184 2.584 0 3.336.456 1.832 1.64 3.512 3.192 4.512.304.2.672.408.824.472.336.144.408.264.472.856.04.36.03.464-.056.464-.056 0-.464-.176-.896-.384l-.04-.03c-2.472-1.216-4.056-3.274-4.632-6.012-.144-.706-.168-2.392-.03-3.04.36-1.74 1.048-3.1 2.192-4.304 1.648-1.737 3.768-2.656 6.128-2.656zm.134 2.81c.409.004.803.04 1.106.106 2.784.62 4.76 3.408 4.376 6.174-.152 1.114-.536 2.03-1.216 2.88-.336.43-1.152 1.15-1.296 1.15-.023 0-.048-.272-.048-.603v-.605l.416-.496c1.568-1.878 1.456-4.502-.256-6.224-.664-.67-1.432-1.064-2.424-1.246-.64-.118-.776-.118-1.448-.008-1.02.167-1.81.562-2.512 1.256-1.72 1.704-1.832 4.342-.264 6.222l.413.496v.608c0 .336-.027.608-.06.608-.03 0-.264-.16-.512-.36l-.034-.011c-.832-.664-1.568-1.842-1.872-2.997-.184-.698-.184-2.024.008-2.72.504-1.878 1.888-3.335 3.808-4.019.41-.145 1.133-.22 1.814-.211zm-.13 2.99c.31 0 .62.06.844.178.488.253.888.745 1.04 1.259.464 1.578-1.208 2.96-2.72 2.254h-.015c-.712-.331-1.096-.956-1.104-1.77 0-.733.408-1.371 1.112-1.745.224-.117.534-.176.844-.176zm-.011 4.728c.988-.004 1.706.349 1.97.97.198.464.124 1.932-.218 4.302-.232 1.656-.36 2.074-.68 2.356-.44.39-1.064.498-1.656.288h-.003c-.716-.257-.87-.605-1.164-2.644-.341-2.37-.416-3.838-.218-4.302.262-.616.974-.966 1.97-.97z"
        />
      </svg>
    ),
  },
  facetime: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1.5" y="6.5" width="14" height="11" rx="3" fill="#34C759" />
        <path
          fill="#34C759"
          d="M16.8 10.9l4.1-2.9c.5-.36 1.2 0 1.2.62v6.76c0 .62-.7.98-1.2.62l-4.1-2.9z"
        />
      </svg>
    ),
  },
  fitness: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" stroke="#FA114F" strokeWidth="2.6" />
        <circle cx="12" cy="12" r="6" stroke="#92E82A" strokeWidth="2.6" />
        <circle cx="12" cy="12" r="2.6" stroke="#1EEAEF" strokeWidth="2.2" />
      </svg>
    ),
  },
  photos: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        {[
          "#FFCC00",
          "#FF9500",
          "#FF3B30",
          "#FF2D55",
          "#AF52DE",
          "#007AFF",
          "#5AC8FA",
          "#34C759",
        ].map((color, i) => (
          <ellipse
            key={color}
            cx="12"
            cy="6.8"
            rx="2.5"
            ry="4.6"
            fill={color}
            opacity="0.85"
            transform={`rotate(${i * 45} 12 12)`}
          />
        ))}
      </svg>
    ),
  },
  computers: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg
        width={s}
        height={s}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#1F8BF4"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <rect x="2.5" y="4.5" width="19" height="12.5" rx="1.8" />
        <path d="M9 21h6M12 17.5V21" />
      </svg>
    ),
  },
  search: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg
        width={s}
        height={s}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="10.5" cy="10.5" r="6.2" />
        <path d="M15.2 15.2L21 21" />
      </svg>
    ),
  },
  settings: {
    bg: "#0a0a0a",
    render: (s) => (
      <svg width={s} height={s} viewBox="0 0 24 24" aria-hidden="true">
        <g fill="#B8B8BD">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <rect
              key={deg}
              x="10.7"
              y="2"
              width="2.6"
              height="4.5"
              rx="1.2"
              transform={`rotate(${deg} 12 12)`}
            />
          ))}
          <circle cx="12" cy="12" r="7" />
        </g>
        <circle cx="12" cy="12" r="3.2" fill="#0a0a0a" />
      </svg>
    ),
  },
  amc: {
    bg: "#0a0a0a",
    render: (s) => wordmark("AMC+", "#27AAE1", s * 1.1),
  },
  bbciplayer: {
    bg: "#0a0a0a",
    render: (s) => wordmark("iPLAYER", "#FF4C98", s * 0.85),
  },
  sling: {
    bg: "#0a0a0a",
    render: (s) => wordmark("sling", "#00B9FF", s * 1.2),
  },
  watchtrublu: {
    bg: "#0a0a0a",
    render: (s) => wordmark("TruBlu", "#3AA0FF", s),
  },
};

// ── Public API ────────────────────────────────────────────────────────────────

function resolveKey(name: string): string {
  const key = normalize(name);
  return ALIASES[key] ?? key;
}

/** True if the app resolves to a registered full-color brand mark (not the glyph). */
function hasBrandMark(name: string): boolean {
  return resolveKey(name) in BRANDS;
}

/**
 * Curated favorites, in display order. Chosen because each has a real brand mark
 * and is a likely "what's open" hero. Matched against the live HA source_list by
 * normalized key, so spelling variants ("Apple TV" / "Apple TV+", "HBO Max" /
 * "Max") still resolve. An app only ever appears if it's actually installed.
 */
const FAVORITE_APPS = [
  "YouTube",
  "Netflix",
  "Prime Video",
  "Disney+",
  "Hulu",
  "Apple TV+",
  "Spotify",
  "Max",
] as const;

const FAVORITE_RANK = new Map(FAVORITE_APPS.map((name, i) => [resolveKey(name), i]));

/**
 * Orders the live source_list for display: curated favorites first (in
 * FAVORITE_APPS order), then the remaining apps with branded-logo ones before
 * glyph-only fallbacks (each group keeps source_list order). Returns the REAL
 * source_list strings so they stay launchable. Drives BOTH the tile's 2×2 grid
 * and the AllAppsModal browse list, so the two never disagree.
 */
export function tvAppsInOrder(sourceList: string[]): string[] {
  const rankOf = (a: string) => FAVORITE_RANK.get(resolveKey(a));
  const favorites = sourceList
    .filter((a) => rankOf(a) !== undefined)
    .sort((a, b) => (rankOf(a) ?? 0) - (rankOf(b) ?? 0));
  const rest = sourceList.filter((a) => rankOf(a) === undefined);
  const branded = rest.filter(hasBrandMark);
  const glyphOnly = rest.filter((a) => !hasBrandMark(a));
  return [...favorites, ...branded, ...glyphOnly];
}

/** Derives a deterministic 2-letter monospace glyph from a real app name. */
function fallbackGlyph(name: string): string {
  const words = name
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] ?? name;
  return (w.slice(0, 2) || "??").toUpperCase();
}

interface TvAppMarkProps {
  name: string;
  /** Square edge the mark is sized to fit within, in px. */
  size: number;
}

/**
 * Renders ONLY the brand mark (no plate) sized to fit `size`. Use this when the
 * surrounding cell already provides the rounded plate (e.g. the grid cells).
 * Falls back to a 2-letter monospace glyph for apps without a registered mark.
 */
export function TvAppMark({ name, size }: TvAppMarkProps) {
  const brand = BRANDS[resolveKey(name)];
  if (brand) return <>{brand.render(size)}</>;
  return (
    <span
      style={{
        fontFamily: "var(--mono)",
        fontWeight: 700,
        fontSize: size * 0.6,
        letterSpacing: "0.02em",
        color: "var(--ink-2)",
      }}
    >
      {fallbackGlyph(name)}
    </span>
  );
}

interface TvAppLogoProps {
  name: string;
  /** Square edge of the logo plate in px. */
  size: number;
  /** Plate corner radius (defaults proportional to size). */
  radius?: number;
}

/**
 * Renders an app's brand mark on a standalone rounded plate (hero cell, modal
 * grid). Wraps {@link TvAppMark}.
 */
export function TvAppLogo({ name, size, radius }: TvAppLogoProps) {
  const brand = BRANDS[resolveKey(name)];
  const r = radius ?? Math.round(size * 0.26);

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: brand ? brand.bg : "var(--nest)",
        border: "1px solid var(--hair)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <TvAppMark name={name} size={size * 0.56} />
    </div>
  );
}
