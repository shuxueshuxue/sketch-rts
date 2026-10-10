// Hand-drawn combat emblems. The SVG exporter supplies the material gradients.
const ink = (art) => `<g stroke="#101820" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${art}</g>`;

export const physicalIcons = {
  charge: ink(`
    <path d="M21 95 87 31 97 38 31 103Z" fill="url(#wood)"/>
    <path d="m81 36 19-17 9 4-4 13-18 10Z" fill="url(#steel)"/>
    <path d="m92 31 11-9-4 12" fill="none" stroke="#e2ece7" stroke-width="1.5"/>
    <path d="m33 89 10-8m-17 17 7-7m16-16 25-25" fill="none" stroke="#e1b97c" stroke-width="1.5"/>
    <path d="m48 30 6-10 8 15 16 10-3 12-8 3 1 15-14 15-17-2 10-19-5-9-13 1-5-8 8-16Z" fill="url(#steel)"/>
    <path d="m53 35-13 3-7 12 12-2 9 9-1 12-8 13 9 1 10-11-1-15 9-3-3-7Z" fill="#758891"/>
    <path d="m45 32-8 2-10 9-3 11 4 6 11-2-3 10-8 10 7 11 10-19-4-9 3-9-6-3" fill="url(#leather)"/>
    <path d="m53 24 5 12m-11 1-10 8m15 14 3 6-5 12m5 9 7-11m5-27 6 3" fill="none" stroke="#dce7e3" stroke-width="1.7"/>
    <path d="m37 49 9-2m-12 9 7-2m-10 19 6-4" fill="none" stroke="#d3ac77" stroke-width="1.4"/>
    <path d="m54 46 7-1-3 4Z" fill="#11191c" stroke-width="1.2"/>
    <path d="m64 56 6 2m-33-1 3 3m5 22 5-8" fill="none" stroke-width="1.6"/>
    <path d="M20 80 35 75m-17 15 13-5m49-9 22-12m-12 23 19-10" fill="none" stroke="#98bfae" stroke-width="2"/>
    <path d="m87 41 6 5m-12 0 5 6" fill="none" stroke="#715434" stroke-width="1.5"/>
    <path d="m93 95 8-4m-16 11 13-8M20 68l9-3" fill="none" stroke="#c8ddd2" stroke-width="1.3"/>
  `),

  stomp: ink(`
    <path d="m20 95 16-8 9 4 12-6 13 5 10-7 26 13-18 8-19-2-12 6-16-7-14 2Z" fill="url(#steel)"/>
    <path d="m35 91 13 4-6 8m16-14 6 10-7 9m22-20-8 10 8 7m8-9 13 1" fill="none" stroke="#e0e5db" stroke-width="1.6"/>
    <path d="m51 23 29 4 6 35 13 16-3 12-21 5-32-2-12-10 4-16 12-8Z" fill="url(#steel)"/>
    <path d="m49 28 24 4 5 31-29-3Z" fill="#77828b"/>
    <path d="m40 64 40 0 14 15-3 8-18 4-28-2-9-8Z" fill="#8b9799"/>
    <path d="m53 33 16 3m-18 4 18 3m-20 5 21 3m-21 4 20 3" fill="none" stroke="#d6e4df" stroke-width="1.8"/>
    <path d="m51 24 9 9 14-2m4 5-7 11 8 8m-28 0 8-9-7-6" fill="none" stroke="#3d4f58" stroke-width="1.6"/>
    <path d="m42 68 11 2-4 14m14-14 0 18m11-20 6 17m-41-5 8 6 26 2 15-4" fill="none" stroke="#d9e5df" stroke-width="1.8"/>
    <path d="m43 66 2-6 12-2m19 8 6 3m-15 8 7-4m-24 8-5-3" fill="none" stroke-width="1.5"/>
    <path d="m34 87-9-6-3-13m10 5-5-2m10 21-13 0-7 7m79-14 9-7 3-12m-4 27 8 3m-47 12-3 6m-20-10-7 8" fill="none"/>
    <path d="m19 52 7 6-4 5-8-7Zm79-8 8 4-3 9-7-5Zm-7 14 5 2-1 5-6-2Z" fill="url(#steel)"/>
    <path d="m27 39 6 11m67-18-5 13m-9-26 2 11" fill="none" stroke="#c8d6c7" stroke-width="1.8"/>
  `),

  pinningBolt: ink(`
    <path d="m40 28 27-7 24 11 4 34-11 25-26 17-23-20-9-30Z" fill="url(#wood)"/>
    <path d="m43 34 23-7 19 9 4 29-10 21-21 16-19-18-8-26Z" fill="url(#leather)"/>
    <path d="m43 35 6 22-1 33m13-61 1 66m16-61-5 21 6 28" fill="none" stroke="#977449" stroke-width="1.7"/>
    <path d="m44 40 19-6 18 8m-44 22 6 18 14 12m26-34-8 21-9 7" fill="none" stroke="#d6ad76" stroke-width="1.7"/>
    <path d="m37 34 7 4m43-2-6 5m11 23-6-1m-48 23 6-4m17 23-1-7m23-10-6-3" fill="none" stroke="#f0c995" stroke-width="2"/>
    <path d="m41 38 1 1m-7 16 1 1m2 22 1 1m14 18 1 1m18-7 1-1m14-25 1-1m-5-18 1-1m-21-16 1 1" fill="none" stroke="#2d2922" stroke-width="3.4"/>
    <path d="m48 67 6-8 13 1 6 10-8 9-12-3Z" fill="url(#bronze)"/>
    <path d="m54 66 7-3 6 4-1 7-8 2-5-5Z" fill="#8b683e"/>
    <path d="m21 89 72-54 5 6-73 55Z" fill="url(#wood)"/>
    <path d="m90 35 14-13 6 4-8 17-10 3Z" fill="url(#steel)"/>
    <path d="m100 30 6-4-6 13m-8 3-3-4" fill="none" stroke="#e4ece5" stroke-width="1.5"/>
    <path d="m24 86-8 0 9-11 10-3 0 8m-8 13-3 11 16-8 2-11" fill="url(#bone)"/>
    <path d="m20 84 9-6m1 20 6-8m2-9 48-35" fill="none" stroke="#e0c698" stroke-width="1.5"/>
    <path d="m57 59-6-9m16 17 12-4m-20 12-2 11m7-29 5-7m-18 24-7 3" fill="none" stroke-width="1.5"/>
    <path d="m86 98 8-7m-63-53-8 9" fill="none" stroke="#a6c1aa" stroke-width="1.7"/>
  `),

  incendiaryFlume: ink(`
    <path d="M26 99c3-16 16-26 25-19 7-15 14-14 18-9 9-18 19-9 22-26 15 18 1 24 10 34 7 9 5 21-5 25-24 7-48 8-70-5Z" fill="url(#flame)"/>
    <path d="M35 100c2-10 9-17 18-11 7-13 17-7 18-17 9 10 1 16 13 17 7 0 11 8 5 13Z" fill="#f6c867" stroke="#ae502c" stroke-width="1.5"/>
    <path d="M43 101c1-4 5-8 11-5 6-8 11-3 12-10 4 6 3 10 11 13l-3 7-21 2Z" fill="#fbe7a1" stroke="none"/>
    <path d="m30 32 26-8 27 18-2 23-20 14-23-10-15-20Z" fill="url(#bronze)"/>
    <path d="m37 31 23-2 17 14-4 18-15 9-18-8-11-13Z" fill="#c69a53"/>
    <path d="M57 25c1-11 20-10 29 0 6 7 7 15 2 23l-8-4c2-6 1-11-3-15-6-5-10-5-13 0Z" fill="url(#leather)"/>
    <path d="m82 49 17-3 9 7-15 12-16 2Z" fill="url(#bronze)"/>
    <path d="m95 49 7 4-10 7m-59-24 6 21 16 8m-13-25 14-2 13 8m-33-9 21-6" fill="none" stroke="#f2d493" stroke-width="1.7"/>
    <path d="m29 50 10 12 20 9m14-30-6 16m-20-13 12 3m-1 7 7-3m-34-9 5-1" fill="none" stroke="#75542e" stroke-width="1.5"/>
    <path d="m60 21 7 4m4-6 2 7m7-3-2 7m7-1-4 6" fill="none" stroke="#d8b57d" stroke-width="1.4"/>
    <path d="M100 62c-1 5-11 12-9 19 3 5-3 8-6 4-4-7 7-13 7-18Zm-8 7c-4 5-15 10-11 16m20-17c-1 6-4 9-2 13" fill="none" stroke="#342921" stroke-width="3.7"/>
    <path d="m19 80 6 8m82 3 3 8m-33-37 3 9m-35 30 5 2" fill="none" stroke="#ffce76" stroke-width="1.8"/>
    <path d="M76 48c4 6 2 11-3 14m-34-6 3 1" fill="none" stroke="#f8dfa7" stroke-width="1.3"/>
  `),

  veteranResilience: ink(`
    <path d="m62 18 38 18-3 39c-2 13-15 25-34 36-20-12-34-27-37-40l-3-36Z" fill="url(#steel)"/>
    <path d="m62 26 30 14-3 32c-3 12-12 22-26 31-15-10-26-22-28-35l-3-28Z" fill="#637883"/>
    <path d="m37 44 25-13 24 12-3 27c-2 8-9 17-20 25-13-10-21-18-23-30Z" fill="url(#steel)"/>
    <path d="m62 37 0 20m-17 9 10-8 13 1 14 6-4 15-16 10-16-11Z" fill="#819b9f"/>
    <path d="M53 57c-2-8 2-16 10-17 8 1 13 8 11 16l-4 8-12-1Z" fill="url(#bronze)"/>
    <path d="m52 63 8 7 12-3m-11-20 7 0m-10 4 2 9m7-9-2 9" fill="none" stroke="#f0d191" stroke-width="1.6"/>
    <path d="m30 39 3 28 11 20m46-42-2 23-9 17m-44-45 26-13 25 13m-45 46 18 15" fill="none" stroke="#dfebe7" stroke-width="1.8"/>
    <path d="m33 52 15 5-6 5 13 4m27-24-12 9 5 3-9 8m-25 16 14-5m19 13 9-13m-29 20 6-7" fill="none" stroke="#213b45" stroke-width="2"/>
    <path d="m35 51 12 4m31-12-7 7m-29 29 10-5m23 10 6-8" fill="none" stroke="#bccfca" stroke-width="1.2"/>
    <path d="m28 40 1 1m4 25 1 1m11 23 1 1m45-48 1 1m-4 23 1 1m-13 24 1 1" fill="none" stroke="#b6c5be" stroke-width="3.2"/>
    <path d="m22 73-5 6 6 8m80-20 7 5-4 9m-58 23-3 7m38-9 4 6" fill="none" stroke="#aac4ad" stroke-width="1.8"/>
    <path d="m48 32 7-4m25 11 4 3m-30 50 5 4" fill="none" stroke="#f7f0d8" stroke-width="1.3"/>
  `),

  veteranMobility: ink(`
    <path d="m57 21 30 8-13 39 12 17-2 13-19 5-29-9-10-11 5-12 14-5Z" fill="url(#leather)"/>
    <path d="m56 26 24 7-12 34-19-5Z" fill="#73593d"/>
    <path d="m39 72 18-4 10 5 10 16-14 6-21-7-11-6Z" fill="#ae8856"/>
    <path d="m28 85 16 12 21 7 20-6 0 7-21 6-29-10-11-12Z" fill="url(#bone)"/>
    <path d="m49 38 24 8m-26-1 25 9m-28-1 24 10" fill="none" stroke="#d3b487" stroke-width="4.5"/>
    <path d="m52 35 17 18m4-12L48 49m1 2 17 13m2-13L45 60" fill="none" stroke="#493725" stroke-width="1.7"/>
    <path d="m59 30 13 4m-28 33 12 3m-21 8 12 5 14 3m5-12 8 13m-33 12 23 7 14-4" fill="none" stroke="#e5c99a" stroke-width="1.7"/>
    <path d="m44 70-3 7m14-4 5 11m-20 3-3 5m22-3 1 8m14-9 5 6" fill="none" stroke-width="1.5"/>
    <path d="M85 66c8-8 16-22 14-31-10 4-17 15-19 28Zm0-2 12-25m-8 17 9-3m-5-6 3-1" fill="url(#bone)"/>
    <path d="M31 56c3-7 7-12 12-13m-26 28 18-4m-14 21 10 1m65 8 13-8m-16 17 10-5" fill="none" stroke="#96bfa5" stroke-width="2.2"/>
    <path d="m24 50 10-4m66 23 7-5m-64 44 7 2m-27-9 8 2" fill="none" stroke="#d8e5cd" stroke-width="1.4"/>
    <path d="m59 41 1 1m-5 9 1 1m-5 9 1 1m20-17 1 1m-4 9 1 1m-3 8 1 1" fill="none" stroke="#ecd7aa" stroke-width="2.5"/>
  `),

  veteranCommand: ink(`
    <path d="m27 105 62-70 7 6-61 70Z" fill="url(#steel)"/>
    <path d="m83 37 13-19 12 3-10 19-11 4Z" fill="url(#steel)"/>
    <path d="m29 101 9 6-4 7-9-7Zm-7-6 19 17" fill="url(#leather)"/>
    <path d="m28 36 66 69-7 6-65-69Z" fill="url(#steel)"/>
    <path d="m27 39-8-17 9-3 14 16-3 9Z" fill="url(#steel)"/>
    <path d="m91 100 9 9-6 5-10-10Zm-6 9 18-18" fill="url(#leather)"/>
    <path d="m62 22 1 86 6 0 0-86Z" fill="url(#wood)"/>
    <path d="m64 18 7 4-5 8-5-7Z" fill="url(#bronze)"/>
    <path d="M68 30c13-5 19 3 34-1l-7 14 10 13c-13 6-23-5-37 0Z" fill="url(#green)"/>
    <path d="M72 35c7-2 14 3 21 1l-5 9 6 7c-8 0-14-4-22-1Z" fill="#819572" stroke="none"/>
    <path d="m80 36 7 5-4 8-7-4Z" fill="url(#bone)"/>
    <path d="m68 32 2 20m24-18-6 4m1 9 6 6" fill="none" stroke="#d0d9af" stroke-width="1.6"/>
    <path d="m24 26 11 13m59-15-9 13m-48 52 41-45m-39 10 40 42" fill="none" stroke="#e2e9dc" stroke-width="1.6"/>
    <path d="m26 99 8 6m-6-1 6 5m58-4 5-5m-3 9 5-5m-45-24 3 3m17-5 3 3" fill="none" stroke="#d3a46a" stroke-width="1.4"/>
    <path d="m62 64 8 0m-8 9 8 0m-8 8 8 0" fill="none" stroke="#72502e" stroke-width="1.5"/>
    <path d="m43 102 9 3m29 3 7-5M21 60l5 7m80 0-5 6" fill="none" stroke="#aacbb0" stroke-width="1.8"/>
    <path d="m35 20 3 6m71-5 3 7m-58 79 2 1m19-54 4 0" fill="none" stroke="#ecdfb6" stroke-width="1.3"/>
  `),

  veteranVigilance: ink(`
    <path d="m71 23 27 8-5 15-23-6Z" fill="url(#wood)"/>
    <path d="m71 31-3 56 7 3 3-56m12 1-5 60 7 1 5-58" fill="url(#wood)"/>
    <path d="m65 89 27 6 8 8-4 7-34-5-7-9Z" fill="url(#steel)"/>
    <path d="m68 52 24 5m-24 0 21 23m-21 5 24-27m-20 20 18 4" fill="none" stroke="#d4ae73" stroke-width="3.6"/>
    <path d="m66 25 14-9 23 7 5 15-11 0-2-8-17-5-6 5Z" fill="url(#steel)"/>
    <path d="m77 20 22 6 4 7m-33 0 21 7m-18 44-2 13m18-12-1 11" fill="none" stroke="#dce7dc" stroke-width="1.6"/>
    <path d="m23 61 21-22 26-3 25 14-19 23-27 7Z" fill="url(#bone)"/>
    <path d="M27 60c15-25 43-31 64-11-17 3-30 15-40 25-8-3-15-7-24-14Z" fill="#c8c9a7"/>
    <path d="M33 58c18-17 34-21 50-11-12 3-22 11-32 20Z" fill="#d9e2c4" stroke-width="1.5"/>
    <path d="M51 48c-7 6-6 15 2 19 10 2 16-8 11-16-4-5-8-6-13-3Z" fill="url(#green)"/>
    <path d="M56 49c-3 4-5 9-2 15 5-1 8-7 6-13Z" fill="#152b24"/>
    <path d="m54 49 3 0" fill="none" stroke="#edf2d5" stroke-width="2.7"/>
    <path d="M26 52c9-12 24-19 40-21m-35 36 18 11 21-5m-47-8 10 1m37-30 17 5" fill="none" stroke="#a6c29f" stroke-width="1.8"/>
    <path d="m36 44 5-1m35 13 6-4m-35 20 8-1m22 32 9 1m4-54-1 8" fill="none" stroke="#f0e8c4" stroke-width="1.4"/>
    <path d="m18 45 4-5m82 9 6-3m-9 27 6-1m-64 15-5 5" fill="none" stroke="#b6d1b2" stroke-width="1.6"/>
  `),

  veteranRally: ink(`
    <path d="M28 75c8-2 9-12 20-17 13-6 32-2 35-17l16 8c-9 25-28 19-39 28-7 6-10 19-24 19Z" fill="url(#bronze)"/>
    <path d="M34 80c8-1 10-12 20-16 10-4 27-4 30-16m-41 36c3-7 10-13 20-14" fill="none" stroke="#f0ce87" stroke-width="2"/>
    <path d="M81 37c8-3 17 0 22 5l-9 23c-9 3-18-1-22-5Z" fill="url(#bronze)"/>
    <path d="M85 39c6-1 12 1 16 5l-8 17c-5 1-11-1-14-4Z" fill="#654827"/>
    <path d="M88 44c3-1 7 0 9 2l-5 10c-3 1-6 0-9-1Z" fill="#252c24"/>
    <path d="m29 73 10 22-7 4-11-22Z" fill="url(#steel)"/>
    <path d="m26 77 8 16m-3-8 6-2m25-26 5 16m-17-11 7 17m22-27 7 10" fill="none" stroke="#e3d8ae" stroke-width="1.6"/>
    <path d="M56 70c6 10 8 19 16 26 8 5 16-2 12-9-4-4-6-8-5-14" fill="none" stroke="#5b3e28" stroke-width="5"/>
    <path d="M58 72c6 10 8 17 15 22 4 3 8 0 7-4" fill="none" stroke="#ba9060" stroke-width="1.5"/>
    <path d="m65 95 0 13 9-5 7 4-2-15" fill="url(#green)"/>
    <path d="m66 94 13-2-1 6-11 2Z" fill="url(#bone)"/>
    <path d="m88 29 1-12m11 14 6-9m-8 48 9 6m-3-27 8-1" fill="none" stroke="#d7c480" stroke-width="2.3"/>
    <path d="m75 24 3 5m-43 9 7 9m-22 16 8 3m19 35 6-7" fill="none" stroke="#a9cbae" stroke-width="1.8"/>
    <path d="m46 68 3-3m22-1 5-2m7-9 2-5m-48 28 3-4m20 22 5 0" fill="none" stroke="#fff0bb" stroke-width="1.3"/>
  `),

  veteranPhalanx: ink(`
    <path d="m30 100 3-65 6 0-3 65m55-2 3-65 6 0-3 68m-34-1 0-74 6 0 0 75" fill="url(#wood)"/>
    <path d="m31 34 7-16 5 17-6 4Zm29-10 6-11 6 12-6 5Zm32 8 7-14 5 15-7 5Z" fill="url(#steel)"/>
    <path d="m36 26 1 7m29-14 0 6m33 0-2 8" fill="none" stroke="#e7ede3" stroke-width="1.4"/>
    <path d="m23 45 24-8 18 13-3 36-17 19-20-17Z" fill="url(#steel)"/>
    <path d="m28 49 18-7 13 10-2 31-12 14-15-13Z" fill="#66808b"/>
    <path d="m73 46 23-5 12 12-5 35-20 18-19-17Z" fill="url(#steel)"/>
    <path d="m78 50 15-4 10 9-5 30-15 14-13-14Z" fill="#597984"/>
    <path d="m46 45 22-8 20 14-4 39-19 23-23-24Z" fill="url(#steel)"/>
    <path d="m51 50 16-7 15 11-3 33-14 18-17-19Z" fill="#7b9297"/>
    <path d="m53 56 14-7 12 9-3 28-11 14-12-16Z" fill="url(#steel)"/>
    <path d="m62 63 9-1 6 8-5 10-10 0-6-8Z" fill="url(#bronze)"/>
    <path d="m63 67 6-1 4 5-3 5-6-1-3-4Z" fill="#a57a45"/>
    <path d="m27 49 2 33 12 15m35-47 20-5 8 9m-54-3 18-8 13 10m-34 2 3 32 14 17m13-45-3 28-10 13" fill="none" stroke="#dce9e0" stroke-width="1.7"/>
    <path d="m35 63 7-5 7 7-2 10-10 1-5-8m51-5 8-4 6 8-4 9-8 0-4-7" fill="url(#bronze)" stroke-width="1.7"/>
    <path d="m54 61 7 3m14 18-7 7m-20 5 8 4m-14-14-6-3m61 3-7 3" fill="none" stroke="#2f4a50" stroke-width="1.5"/>
    <path d="m20 97 9 6m71-5 7-5m-45 13-3 5" fill="none" stroke="#a4c5ad" stroke-width="1.7"/>
  `),

  veteranSteadyAim: ink(`
    <path d="M37 23c-18 21-15 55 11 79l7-7c-21-23-28-45-10-65Z" fill="url(#wood)"/>
    <path d="M41 28c-15 21-12 44 9 69" fill="none" stroke="#edcb94" stroke-width="1.8"/>
    <path d="m39 23 10 76" fill="none" stroke="#d9ddd0" stroke-width="1.9"/>
    <path d="m32 58 7 18 9-3-7-18Z" fill="url(#leather)"/>
    <path d="m34 61 10-2m-8 6 10-3m-8 7 10-3m-8 7 10-3" fill="none" stroke="#d5b387" stroke-width="1.4"/>
    <path d="m23 74 68-22 2 5-69 23Z" fill="url(#wood)"/>
    <path d="m88 52 18-12-4 15-13 5Z" fill="url(#steel)"/>
    <path d="m95 52 7-8-3 9m-17 6 8-3" fill="none" stroke="#f1f0dc" stroke-width="1.5"/>
    <path d="m26 72-8-5 13-4 9 4m-15 11-5 8 14-4 7-8" fill="url(#bone)"/>
    <path d="m23 68 9-2m-8 16 10-5m8-8 37-12" fill="none" stroke="#e7caa2" stroke-width="1.4"/>
    <path d="M68 26a28 28 0 0 1 28 26m-28-26a28 28 0 0 0-27 26m0 10a28 28 0 0 0 27 25m28-25a28 28 0 0 1-28 25" fill="none" stroke="#6f9a77" stroke-width="2.2"/>
    <path d="M68 35a19 19 0 0 1 18 15M59 38a19 19 0 0 0-9 12m0 14a19 19 0 0 0 14 13m19-13a19 19 0 0 1-10 12" fill="none" stroke="#a9c99e" stroke-width="1.7"/>
    <path d="m68 20 0 16m0 45 0 13m-32-37 14 0m39 0 15 0" fill="none" stroke="#c5d6b4" stroke-width="2"/>
    <path d="m66 51 5 4-4 5-4-4Z" fill="url(#bronze)" stroke-width="1.7"/>
    <path d="m22 33 3-4m33 68 8 5m20-14 8-3m-6-64 4 5" fill="none" stroke="#d7dfc3" stroke-width="1.5"/>
    <path d="m37 24 5 3m1 67 8 5m36-43 3-1" fill="none" stroke="#9f693e" stroke-width="1.4"/>
  `),

  veteranMarch: ink(`
    <path d="m84 21-5 73 6 0 6-73Z" fill="url(#wood)"/>
    <path d="m82 19 7-5 5 6-7 7Z" fill="url(#bronze)"/>
    <path d="M89 25c8-2 15 5 22 3l-5 12 3 10c-8 2-13-5-22-4Z" fill="url(#green)"/>
    <path d="m91 29 11 4m-14 8 13 4" fill="none" stroke="#bbcba0" stroke-width="1.6"/>
    <path d="m33 26 24 5-5 26 10 13-3 11-21 2-16-13 4-12 8-4Z" fill="url(#leather)"/>
    <path d="m38 31 12 4-4 21-15-1Z" fill="#8e6945"/>
    <path d="m29 61 16-2 11 12-3 6-15 0-10-8Z" fill="#ae8554"/>
    <path d="m24 69 15 13 19-2 1 6-20 3-18-14Z" fill="url(#bone)"/>
    <path d="m36 38 15 4m-17 4 15 4m-18 4 15 4" fill="none" stroke="#d1b083" stroke-width="3"/>
    <path d="m39 38 7 11m2-8-13 8m1 2 8 7m-13 8 9 6m5-10 8 12" fill="none" stroke="#4d3726" stroke-width="1.5"/>
    <path d="m63 49 22 6-6 25 12 13-3 11-20 4-19-11 3-12 8-5Z" fill="url(#leather)"/>
    <path d="m67 54 11 4-5 20-13-3Z" fill="#7b5b3e"/>
    <path d="m56 87 16-3 11 11-1 5-15 2-13-9Z" fill="#ad8454"/>
    <path d="m52 96 17 11 19-3 1 6-22 4-18-13Z" fill="url(#bone)"/>
    <path d="m64 61 16 5m-18 3 16 5m-18 3 16 5" fill="none" stroke="#d3b58b" stroke-width="3"/>
    <path d="m67 62 7 12m3-9-15 7m1 3 7 7m-12 8 11 6m3-8 8 9" fill="none" stroke="#4a3425" stroke-width="1.5"/>
    <path d="m27 64 8 5m20 20 6 0m-2 13 11 7m-35-32 12 7m15-26 0 12" fill="none" stroke="#e2c79b" stroke-width="1.4"/>
    <path d="m19 90 12-2m-10 9 17-3m62-21 8-5m-11 14 10-7m-69 33 9-3" fill="none" stroke="#a2c4a8" stroke-width="2"/>
  `),

  veteranSiegeDrill: ink(`
    <path d="m23 89 60-5 21 9-7 13-67 3-13-9Z" fill="url(#wood)"/>
    <path d="m28 94 56-4 12 5-3 7-62 2-8-6Z" fill="#b28753"/>
    <path d="m33 83 17-46 11 1-6 48Zm32 3 12-42 9 2-7 42Z" fill="url(#wood)"/>
    <path d="m35 51 43-6 9 8-44 7Z" fill="url(#wood)"/>
    <path d="m40 57 36-7m-32 31 9-34m16 37 12-30m-52 43 49-3" fill="none" stroke="#e7bf86" stroke-width="1.8"/>
    <path d="m46 81 26-39 6 4-25 38Z" fill="#775438"/>
    <path d="m39 76 43-18m-39 22 40-19" fill="none" stroke="#ccb591" stroke-width="1.8"/>
    <path d="m31 83 17-4 30-57 7 4-30 59-20 6Z" fill="url(#wood)"/>
    <path d="m73 20 17-3 9 7-7 12-18-3-7-7Z" fill="url(#leather)"/>
    <path d="m77 21 13-1 6 5-5 6-14-2-5-4Z" fill="url(#steel)"/>
    <path d="m80 23 10 1m-54 60 13-3 30-53m-5 9 5 2" fill="none" stroke="#deccb2" stroke-width="1.6"/>
    <path d="m46 72 9-1 2 8-9 2Z" fill="url(#steel)"/>
    <path d="m48 75 6 0m-15-24 5 2m35-6 5 3m-52 43 7 8m33-11 6 10" fill="none" stroke="#535e5f" stroke-width="1.6"/>
    <path d="M31 93c-9-1-15 5-14 12 2 7 13 9 18 4 5-6 3-14-4-16Zm56-5c-8 1-12 8-10 14 2 7 11 10 17 5 7-6 2-18-7-19Z" fill="url(#steel)"/>
    <path d="m26 98 6 3-1 6-6 0-2-5Zm59-5 7 3-1 6-7 0-3-5Z" fill="url(#wood)"/>
    <path d="M22 99c2-4 6-5 9-4m51-1 5-3 5 2" fill="none" stroke="#e1e7d9" stroke-width="1.6"/>
    <path d="m100 68 6-4 5 5-2 9-7 2-6-6Z" fill="url(#steel)"/>
    <path d="M98 54c-2-10-5-16-12-20m11 11 1-5m5 15 3 5" fill="none" stroke="#9bbd9f" stroke-width="1.8"/>
  `),

  veteranEndurance: ink(`
    <path d="m33 108-13-19 19-20 3-19 7-7-3-17 7-6 9 8 7-11 9 1 4 15 8-7 8 5 0 16 8 2 2 15-12 24-23 10-13 16Z" fill="url(#leather)"/>
    <path d="m53 27 6 18 11-4 5-16m8 8-6 13 12 4 5-15m1 15-6 16-12 1-7-9-12 7-14-8" fill="none" stroke="#4f3828" stroke-width="2"/>
    <path d="m45 51 10 7 15-7 9 7 14-5 1 13-11 9-17 2-16-9-9-8Z" fill="#a37b50"/>
    <path d="m49 50 7-3 6 6-6 7-11-4Z" fill="url(#leather)"/>
    <path d="m40 65 16 10 24 0-4 17-15 7-18-11-13-10Z" fill="url(#bone)"/>
    <path d="m33 80 36 17-10 8-32-20Zm7-10 34 16m-29-15 30 9m-29-5 22 10m-24-3 21 13" fill="none" stroke="#a89c80" stroke-width="1.8"/>
    <path d="m36 77 32 16m-32-11 24 12m-17-28 12 9m3 2 18 0m-15 4 14 1" fill="none" stroke="#f1e5c4" stroke-width="1.8"/>
    <path d="m25 91 9 15 18-13-22-10Z" fill="#795434"/>
    <path d="m28 91 8 9 9-6m-24-7 3-2m14 17 4-4m-15-1 4-4" fill="none" stroke="#d1ad7c" stroke-width="1.6"/>
    <path d="m52 26 5 3 3 12m11-19 3 3 2 10m11-4 4 3-1 10m9 9 5 1-1 10m-36-2 5-3m9 9 7-1" fill="none" stroke="#d6ac75" stroke-width="1.7"/>
    <path d="m49 34 7 2m13-4 7-1m10 7 5 2m-44 25 4 3m21 4 9 0m11-11 5-3" fill="none" stroke="#52392b" stroke-width="1.5"/>
    <path d="m18 68 4-8m83 20 6-7m-29 33 10-9m-24 17 5-4m-49-66 5 3" fill="none" stroke="#afc5a4" stroke-width="1.8"/>
    <path d="m58 21 2 3m20-5 1 6m-6 70 0 6" fill="none" stroke="#ecce96" stroke-width="1.3"/>
  `),
};
