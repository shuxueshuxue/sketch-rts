// Hand-drawn spell silhouettes; the common frame and paint gradients are supplied by the exporter.
export const magicIcons = {
  heal: `
    <path d="M23 53C19 26 46 16 65 19C88 15 109 32 105 56C115 78 94 105 66 107C36 106 17 84 23 53Z" fill="url(#halo)"/>
    <path d="M35 36C42 23 61 18 76 23M92 33C103 43 104 60 98 71M27 61C23 51 25 43 29 38" fill="none" stroke="#8bf6a0" stroke-width="2" stroke-linecap="round" opacity=".7"/>
    <path d="M63 27C52 35 43 46 46 59C48 69 55 75 65 77C76 74 83 67 83 58C84 44 72 36 63 27Z" fill="url(#green)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M62 38C57 44 53 48 52 54C51 60 54 65 58 67M65 38C68 47 69 54 66 64" fill="none" stroke="#d8ffb0" stroke-width="2" stroke-linecap="round"/>
    <path d="M60 47L69 47L69 53L75 53L75 62L69 62L69 69L60 69L60 62L54 62L54 53L60 53Z" fill="#e3ffb9" stroke="#195934" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M21 76C27 68 32 63 37 66C43 70 47 77 51 80C54 81 58 82 62 84C66 87 66 92 62 96C53 103 41 98 34 91L26 91Z" fill="url(#bronze)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M23 75C30 70 35 73 40 78L51 86C58 89 63 88 65 92M35 70L40 79M31 75L36 83M29 81L34 88" fill="none" stroke="#513626" stroke-width="2" stroke-linecap="round"/>
    <path d="M104 76C99 68 95 62 89 65C84 68 81 74 77 78C72 82 67 81 64 85C60 89 62 95 67 97C77 102 87 97 94 89L101 90Z" fill="url(#bronze)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M103 75C96 69 91 73 87 78L77 86C70 90 66 88 63 92M90 69L86 77M96 74L91 83M98 80L93 88" fill="none" stroke="#513626" stroke-width="2" stroke-linecap="round"/>
    <path d="M22 86L34 96L26 108L14 98ZM94 95L106 84L114 96L104 108Z" fill="url(#leather)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M20 91L29 99M99 99L108 90M30 73C33 73 39 79 41 82M88 77C92 73 95 73 98 75" fill="none" stroke="#f7d5a0" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M40 49C35 53 34 59 38 63M89 49C95 54 93 62 89 65M44 78C47 74 50 73 54 73M75 73C79 74 82 76 83 80" fill="none" stroke="#b9ffbc" stroke-width="1.7" stroke-linecap="round"/>
  `,

  summon: `
    <path d="M22 53C21 27 40 16 64 18C87 16 108 35 105 62C115 93 90 110 63 109C35 108 17 87 22 53Z" fill="url(#halo)"/>
    <path d="M28 94L28 49C29 25 45 17 64 18C85 17 101 34 101 52L101 96L90 99L89 52C88 35 78 28 65 28C51 28 40 35 40 51L40 99Z" fill="url(#steel)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M37 85L37 50C36 34 49 24 64 24C82 24 94 37 94 54L94 85" fill="none" stroke="#87fbef" stroke-width="3" stroke-linecap="round"/>
    <path d="M43 50C43 34 85 32 86 50L87 91C80 105 49 104 41 91Z" fill="#102f47" stroke="#17242f" stroke-width="2"/>
    <path d="M45 77C42 65 50 60 50 49C51 38 61 36 66 39C80 41 75 52 82 59C87 66 85 78 76 87C71 92 75 97 82 100C72 103 63 98 62 93C58 99 52 100 46 98C49 95 53 89 51 84C49 80 46 82 45 77Z" fill="url(#aqua)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M55 49C57 44 62 42 66 43M78 65C81 75 73 79 69 86M53 72C52 78 57 82 57 87" fill="none" stroke="#d0fff4" stroke-width="2" stroke-linecap="round"/>
    <path d="M54 57C58 55 61 58 61 63C58 64 55 62 54 57ZM67 61C66 57 72 54 76 55C76 60 72 62 67 61Z" fill="#143850" stroke="#101820" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M61 71C64 69 67 69 69 70C68 75 67 78 65 79C62 78 61 75 61 71Z" fill="#20667c"/>
    <path d="M25 99C36 90 46 97 49 101C60 106 78 105 84 100C92 97 100 95 107 100C96 109 80 110 63 110C45 110 32 108 25 99Z" fill="url(#aqua)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M35 101C52 109 81 108 98 101M29 60L33 57L34 64L30 67ZM94 71L98 68L99 75L95 77M31 40L36 43L32 48M56 21L56 28M76 22L72 29" fill="none" stroke="#d0f8ed" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M22 75C18 69 20 63 23 60M105 66C111 73 111 81 106 87M45 17L42 23M82 18L85 25" fill="none" stroke="#6ae6ed" stroke-width="1.8" stroke-linecap="round"/>
  `,

  curse: `
    <path d="M26 37C35 19 58 18 72 22C97 19 111 47 103 68C115 89 86 111 64 110C34 113 15 92 22 68C17 56 21 44 26 37Z" fill="url(#halo)"/>
    <path d="M39 36C28 38 24 49 28 58C20 59 17 64 18 71C27 66 32 68 34 74L47 61ZM86 36C98 37 103 48 98 57C107 58 111 63 111 70C102 65 96 68 94 74L79 61Z" fill="url(#violet)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M63 29C40 28 31 44 34 65C34 76 39 81 46 84L45 95L55 98L60 107L69 105L74 97L84 93L82 82C93 77 97 64 94 53C92 35 78 27 63 29Z" fill="url(#bone)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M40 56C49 45 58 45 64 44C75 43 87 48 91 55C81 65 72 68 63 67C54 66 46 64 40 56Z" fill="url(#violet)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M44 56C56 48 73 46 87 55C76 63 56 65 44 56Z" fill="#dec3fb" stroke="#42225d" stroke-width="1.5"/>
    <path d="M64 48C60 51 58 58 61 63L67 63C71 58 69 50 64 48Z" fill="#202135" stroke="#101820" stroke-width="1.5"/>
    <path d="M46 72C49 69 54 68 58 70L57 79L49 80ZM72 69C76 68 81 69 83 72L79 80L71 78ZM65 72L60 86L69 85Z" fill="#35303d" stroke="#101820" stroke-width="2" stroke-linejoin="round"/>
    <path d="M50 89L77 87L73 98L69 100L66 94L63 101L59 100L57 94L53 97Z" fill="#43364f" stroke="#101820" stroke-width="2" stroke-linejoin="round"/>
    <path d="M41 41C45 35 50 34 55 35M79 37L86 43M38 66L40 76L44 79M83 66L82 75M56 86L54 91M72 84L74 91" fill="none" stroke="#f4edcb" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M60 30L58 36L64 40L68 35L66 28M49 43L47 47M76 43L80 48M53 91L52 94M61 91L61 95M70 90L71 93" fill="none" stroke="#563b66" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M26 89C20 88 19 80 23 75M102 77C108 81 106 91 100 93M42 24C46 20 54 18 58 20M75 20C82 20 87 24 89 27M45 107C40 104 36 100 34 95" fill="none" stroke="#c68cff" stroke-width="2" stroke-linecap="round"/>
    <path d="M25 39L20 34L23 31L28 36M101 40L107 35L103 31L98 36" fill="none" stroke="#dec3fb" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  `,

  emberMend: `
    <path d="M24 47C28 28 47 15 65 20C89 15 108 37 104 58C113 77 103 99 78 107C52 116 21 98 20 79C16 66 20 56 24 47Z" fill="url(#halo)"/>
    <path d="M63 24C65 36 78 40 79 53C84 48 85 44 84 39C97 52 97 67 84 79C77 85 59 85 50 78C38 70 37 58 45 47C46 55 49 57 52 59C57 49 54 38 63 24Z" fill="url(#flame)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M65 49C63 56 55 60 56 69C55 78 65 81 73 76C80 71 76 62 71 58C72 64 69 67 67 66C65 61 68 57 65 49Z" fill="#fff2a8" stroke="#a85c22" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M51 52C47 59 44 63 49 71M73 41C77 47 76 51 75 55M82 63C84 68 80 74 77 75" fill="none" stroke="#fff7bf" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M24 70C28 65 33 66 35 70L44 82C48 83 55 80 60 82C65 84 69 91 64 96C59 103 48 103 39 98L30 89L22 91L16 81Z" fill="url(#bronze)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M31 69C29 73 35 80 40 84C46 89 52 88 57 89M33 81L30 78M38 89L33 85M50 96C55 98 61 96 63 93" fill="none" stroke="#50302a" stroke-width="2" stroke-linecap="round"/>
    <path d="M103 68C98 64 94 66 92 71L84 80C80 82 73 79 69 82C65 84 61 91 66 96C72 102 84 101 91 96L100 87L109 90L114 80Z" fill="url(#bronze)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M98 69C101 73 94 80 90 84C84 88 77 88 72 89M95 81L99 77M90 90L97 84M68 92C70 96 76 97 80 96" fill="none" stroke="#50302a" stroke-width="2" stroke-linecap="round"/>
    <path d="M17 87L30 96L24 109L14 102ZM99 95L111 86L114 100L105 107Z" fill="url(#leather)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M19 93L26 99M104 99L111 93M33 72C35 77 38 80 41 81M96 72C93 76 91 79 89 80" fill="none" stroke="#ffdca5" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M37 64C24 57 30 45 37 44M91 43C104 48 107 59 97 65M46 84C53 80 77 79 84 84" fill="none" stroke="#ffda6e" stroke-width="2" stroke-linecap="round"/>
    <path d="M37 33C34 27 37 22 41 20C40 27 44 27 43 31C42 34 40 36 37 33ZM91 27C88 24 90 19 92 17C92 20 96 23 95 25C95 28 93 29 91 27Z" fill="#ffc26b" stroke="#913b32" stroke-width="1.5" stroke-linejoin="round"/>
  `,

  cinderSoul: `
    <path d="M24 47C30 19 47 17 62 21C86 14 108 31 104 59C116 84 101 104 79 109C56 117 25 102 21 79C17 65 20 57 24 47Z" fill="url(#halo)"/>
    <path d="M64 16C68 29 81 35 79 49C85 45 88 38 86 29C98 39 106 51 101 65C109 64 111 60 111 54C118 76 101 89 88 93C91 99 97 99 103 98C94 109 81 110 71 102C67 110 55 112 46 106C52 102 54 99 51 96C30 96 18 87 18 70C22 78 30 79 33 74C26 65 29 55 35 49C35 59 40 62 44 60C46 47 42 31 52 25C51 38 55 43 59 43C62 33 55 27 64 16Z" fill="url(#flame)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M60 43C47 53 47 71 53 81C55 87 53 93 49 97C59 98 63 93 64 87C68 91 72 97 70 104C83 100 84 87 82 78C81 71 84 66 79 59C76 62 75 65 74 68C68 59 69 49 60 43Z" fill="#ffe199" stroke="#9f4b28" stroke-width="2" stroke-linejoin="round"/>
    <path d="M53 62C58 62 61 65 60 70C55 70 53 67 53 62ZM67 70C68 65 72 62 77 63C77 67 73 70 67 70Z" fill="#542a34" stroke="#101820" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M62 75C65 74 68 75 69 77C69 82 68 86 65 88C61 85 60 80 62 75Z" fill="#9c422e" stroke="#613332" stroke-width="1.4"/>
    <path d="M59 53C55 56 54 58 54 60M69 53C71 57 71 59 72 61M57 79C58 85 57 89 55 92M74 82C76 88 76 92 74 95" fill="none" stroke="#fff8c7" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M42 70C38 76 36 79 29 81M85 78C92 79 97 75 98 70M47 42C46 50 49 53 46 60M74 31C77 38 75 42 73 45M82 97C86 101 91 103 95 103" fill="none" stroke="#ffb568" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M29 34C24 30 26 23 30 20C28 28 35 29 34 33C33 36 30 37 29 34ZM101 36C96 32 99 25 102 23C102 30 109 33 107 38C105 41 102 39 101 36ZM21 96C16 91 18 84 20 81C22 88 27 90 26 94C25 98 23 99 21 96Z" fill="#ffcf79" stroke="#a54a2f" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M43 19L41 25M89 17L91 23M110 89L105 93" fill="none" stroke="#fff0ad" stroke-width="1.8" stroke-linecap="round"/>
  `,

  ashCurse: `
    <path d="M26 44C32 21 52 19 66 21C88 17 111 36 105 60C115 82 98 106 73 109C49 112 24 100 20 79C16 66 20 52 26 44Z" fill="url(#halo)"/>
    <path d="M26 92C21 77 29 57 37 52C32 66 42 69 47 65C49 50 35 41 43 30C45 44 56 42 59 34C67 18 83 20 88 27C80 24 74 32 78 39C83 45 95 46 99 60C103 72 101 83 94 91C99 92 103 90 106 86C103 105 77 111 56 108C37 106 26 104 26 92Z" fill="#453b50" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M32 85C32 99 52 105 66 103C84 106 98 96 98 83M42 44C46 51 47 57 43 64M91 54C97 66 96 72 92 77" fill="none" stroke="#9d859c" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M44 75C30 62 28 41 31 31C39 47 54 49 66 57C78 65 80 77 74 89L54 92Z" fill="#253342" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M69 54C66 39 75 31 87 34C94 35 97 41 97 47L109 52L96 57C91 75 81 84 76 91L61 91C64 81 64 69 69 54Z" fill="url(#steel)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M66 59C75 64 75 75 69 84L63 96L50 103L53 93L43 97L50 87C37 86 31 81 29 75C42 78 51 72 55 66Z" fill="#344254" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M36 45C41 53 46 57 53 61M42 62C47 66 53 66 60 67M38 73C46 76 53 75 59 71M48 84C54 83 59 79 62 75M74 40C78 36 84 36 89 40M85 57C83 67 78 71 77 77" fill="none" stroke="#8c99a5" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M94 48L106 52L94 54Z" fill="#b1aeb0" stroke="#101820" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M83 43C87 41 91 43 91 46C87 48 84 47 83 43Z" fill="#f2a4ff" stroke="#101820" stroke-width="1.5"/>
    <path d="M88 43L87 46M67 89L67 97L61 100M77 88L78 98L85 101" fill="none" stroke="#101820" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M37 103C53 96 73 97 93 103M25 37C19 42 21 48 26 50M106 65C111 70 109 76 105 78M51 22L47 27M71 19L68 24" fill="none" stroke="#c1a2d3" stroke-width="1.7" stroke-linecap="round"/>
  `,

  bloodlust: `
    <path d="M27 38C41 18 62 21 73 19C99 17 111 42 105 62C116 89 94 109 67 110C39 115 15 91 21 69C16 54 20 46 27 38Z" fill="url(#halo)"/>
    <path d="M36 43L28 22L49 34L64 26L81 34L102 23L93 45C104 57 105 71 96 81L92 93L77 102L63 109L48 101L34 92L29 78C20 65 25 53 36 43Z" fill="url(#ruby)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M36 31L43 41L36 44ZM94 31L86 41L93 44Z" fill="#381e2c" stroke="#101820" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M37 50C45 46 51 49 58 56L54 65C43 64 38 61 37 50ZM90 50C82 46 75 50 70 56L73 65C84 64 89 60 90 50Z" fill="#361b2a" stroke="#101820" stroke-width="2" stroke-linejoin="round"/>
    <path d="M42 54L52 58L49 60ZM86 54L76 58L78 60Z" fill="#ffda73" stroke="#e87b46" stroke-width="1"/>
    <path d="M52 65L64 60L76 65L71 75L57 75Z" fill="#2b1c27" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M38 71C47 69 56 75 64 76C71 75 82 68 91 71L85 93L75 100L64 104L53 101L42 93Z" fill="#291a25" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M41 73L52 76L49 91L45 94L42 86ZM78 76L89 73L86 86L81 94L78 90Z" fill="url(#bone)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M56 80L61 81L59 88ZM66 81L72 79L70 88ZM51 98L55 90L60 100ZM67 100L72 90L77 97Z" fill="#efdfb3" stroke="#101820" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M36 56L32 62L36 67M93 56L96 61L92 66M48 37C55 33 58 34 60 36M68 35L76 39M63 38L64 52M39 84L35 76M89 82L94 75M58 94C61 91 66 91 70 94" fill="none" stroke="#ff876d" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M24 100C17 89 18 81 21 76L30 93L36 98L33 108ZM98 99L108 77C112 86 112 93 108 103L100 110ZM22 46L17 43L21 36M104 44L111 41L107 34" fill="url(#ruby)" stroke="#101820" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M19 88L27 99M108 90L103 101M26 28L29 33M99 28L97 33" fill="none" stroke="#ffad83" stroke-width="1.5" stroke-linecap="round"/>
  `,

  web: `
    <path d="M25 37C36 19 57 18 74 21C102 23 112 43 105 68C114 90 88 112 64 109C38 112 18 93 21 69C17 54 20 44 25 37Z" fill="url(#halo)"/>
    <path d="M28 28C39 36 52 31 63 19C71 33 84 37 100 29C93 44 96 56 110 65C95 73 92 89 101 103C84 97 72 100 64 112C57 100 40 96 27 104C34 88 29 75 17 66C31 57 34 43 28 28Z" fill="#6d4225" fill-opacity=".33" stroke="#101820" stroke-width="4" stroke-linejoin="round"/>
    <path d="M28 28C39 36 52 31 63 19C71 33 84 37 100 29C93 44 96 56 110 65C95 73 92 89 101 103C84 97 72 100 64 112C57 100 40 96 27 104C34 88 29 75 17 66C31 57 34 43 28 28Z" fill="none" stroke="#eec878" stroke-width="2" stroke-linejoin="round"/>
    <path d="M63 20L64 111M29 29L100 102M99 30L28 103M18 66L109 65" fill="none" stroke="#101820" stroke-width="4" stroke-linecap="round"/>
    <path d="M63 20L64 111M29 29L100 102M99 30L28 103M18 66L109 65" fill="none" stroke="#e9b76a" stroke-width="2" stroke-linecap="round"/>
    <path d="M42 42C48 44 57 39 63 34C70 43 78 45 86 43C82 51 84 60 94 65C84 71 82 79 87 88C77 84 71 88 64 96C59 87 48 84 42 88C46 80 44 73 34 66C45 60 47 50 42 42ZM52 53C56 53 61 49 63 46C67 52 72 54 77 53C75 59 78 63 82 66C77 70 75 74 77 79C71 78 68 82 64 85C60 79 56 78 51 79C54 73 52 69 47 66C53 62 55 58 52 53Z" fill="none" stroke="#101820" stroke-width="3.7" stroke-linejoin="round"/>
    <path d="M42 42C48 44 57 39 63 34C70 43 78 45 86 43C82 51 84 60 94 65C84 71 82 79 87 88C77 84 71 88 64 96C59 87 48 84 42 88C46 80 44 73 34 66C45 60 47 50 42 42ZM52 53C56 53 61 49 63 46C67 52 72 54 77 53C75 59 78 63 82 66C77 70 75 74 77 79C71 78 68 82 64 85C60 79 56 78 51 79C54 73 52 69 47 66C53 62 55 58 52 53Z" fill="none" stroke="#f6d98b" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M61 68L49 60L43 47M59 72L44 70L35 57M60 78L47 84L39 96M64 80L58 94L58 102M68 69L79 59L84 47M70 73L85 69L94 57M68 78L80 85L87 98M67 81L73 94L71 104" fill="none" stroke="#101820" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M63 55C54 56 53 66 58 71C57 79 61 85 66 84C72 82 73 77 69 71C73 64 71 56 63 55Z" fill="url(#bronze)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M60 61C61 58 65 58 67 61M61 75L66 79M59 69L68 69" fill="none" stroke="#ffeab3" stroke-width="1.5" stroke-linecap="round"/>
  `,

  veteranHealingWave: `
    <path d="M25 39C36 20 54 16 73 21C94 17 112 41 105 62C113 87 98 105 72 109C43 115 20 96 20 76C17 61 20 48 25 39Z" fill="url(#halo)"/>
    <path d="M24 87C35 89 42 85 45 78C50 65 62 52 77 52C91 51 97 62 93 72C91 78 85 82 78 81C87 92 106 89 110 77C114 94 101 109 81 107C63 107 58 95 49 94C41 98 31 100 22 96Z" fill="url(#aqua)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M53 81C54 67 67 58 79 59C88 59 92 66 88 72C86 77 80 76 77 73M64 88C75 102 98 101 105 91M28 93C37 95 42 90 46 87" fill="none" stroke="#c0fff0" stroke-width="2" stroke-linecap="round"/>
    <path d="M21 64C32 69 44 62 45 50C47 34 64 25 79 29C93 32 97 43 95 52C103 48 106 42 104 34C115 49 105 69 86 68C77 67 75 58 68 57C56 58 54 70 44 75C35 79 24 76 21 64Z" fill="url(#aqua)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M46 56C50 40 61 32 75 34C86 36 88 43 85 50M82 61C91 66 100 59 103 54M26 70C34 73 41 67 43 63" fill="none" stroke="#cefef3" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M32 99C44 87 59 75 69 66C83 54 94 44 99 27L103 28C99 49 86 63 73 74C59 87 47 98 37 108Z" fill="url(#green)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M51 88C39 86 29 88 25 81C27 69 45 71 52 83ZM66 74C54 71 47 67 46 57C58 53 69 63 66 74ZM79 61C68 55 66 45 69 39C81 43 85 53 79 61ZM89 48C93 36 101 34 109 35C108 47 99 53 89 48ZM73 75C82 72 94 76 98 83C88 89 77 87 73 75ZM51 94C60 89 75 91 80 99C68 107 55 106 51 94Z" fill="url(#green)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M31 79L46 82M51 62L62 70M72 45L77 56M104 39L95 46M79 79L91 82M58 98L72 99M39 99L61 82" fill="none" stroke="#c3f3a6" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M29 43C23 40 26 34 29 31C29 36 34 38 33 41C32 44 31 45 29 43ZM40 27C35 24 39 19 41 17C41 22 44 23 44 25C44 27 42 29 40 27Z" fill="#baffd0" stroke="#277f6b" stroke-width="1.5" stroke-linejoin="round"/>
  `,

  veteranInnerFire: `
    <path d="M24 48C27 27 48 17 65 19C88 17 108 37 104 60C114 83 99 107 73 110C45 115 22 97 20 78C18 66 20 56 24 48Z" fill="url(#halo)"/>
    <path d="M65 17C67 32 85 36 82 50C89 46 94 38 91 30C107 43 109 65 100 77C111 75 112 70 113 65C116 84 105 97 91 102C77 108 48 111 33 100C18 89 19 70 29 57C27 71 34 75 40 73C42 60 33 45 42 34C42 44 51 48 54 45C61 36 53 27 65 17Z" fill="url(#flame)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M64 37C66 49 79 53 77 64C86 59 89 59 92 63C96 73 92 87 81 92C68 100 51 96 43 87C36 80 41 63 48 58C48 66 52 69 56 67C59 59 56 48 64 37Z" fill="url(#violet)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M36 74C43 67 53 64 64 63C78 64 88 66 97 75C86 85 75 89 64 90C52 88 42 84 36 74Z" fill="#edc779" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M42 75C51 69 58 68 65 68C76 69 85 71 91 75C80 81 73 85 65 84C56 84 49 80 42 75Z" fill="#fff2c6" stroke="#90622d" stroke-width="1.7" stroke-linejoin="round"/>
    <path d="M64 68C56 69 55 80 60 84C65 88 73 82 72 76C73 72 69 67 64 68Z" fill="url(#violet)" stroke="#101820" stroke-width="2.5"/>
    <path d="M64 71L61 77L65 83L69 77L67 71Z" fill="#251d37" stroke="#101820" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M62 71L64 71L63 75L60 75Z" fill="#fffbd7"/>
    <path d="M42 74L36 69M50 68L47 63M58 65L57 60M75 65L77 60M84 69L88 65M92 74L99 70" fill="none" stroke="#eab963" stroke-width="2" stroke-linecap="round"/>
    <path d="M49 47C50 50 54 52 57 52M68 31C70 37 76 40 78 44M99 50C103 57 103 64 99 69M28 80C30 92 41 97 47 99M82 99C92 97 101 93 106 87" fill="none" stroke="#fff5ad" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M60 92L64 100L71 92M48 89L47 93M85 88L87 93M62 52L65 58L70 53" fill="none" stroke="#e9d1ff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M29 39C24 35 27 27 31 25C29 32 36 34 34 38C33 41 31 42 29 39ZM101 27C96 23 99 18 102 16C102 20 107 24 106 27C105 30 102 29 101 27Z" fill="#ffcf7b" stroke="#934836" stroke-width="1.5" stroke-linejoin="round"/>
  `,

  veteranRenewal: `
    <path d="M23 43C31 21 55 15 70 20C96 18 111 41 105 62C115 90 94 107 69 110C42 113 20 94 19 75C16 60 20 50 23 43Z" fill="url(#halo)"/>
    <path d="M99 33C82 16 44 16 28 40C12 62 24 91 48 100C35 86 33 78 33 65C33 45 48 31 66 31C78 29 92 33 99 39Z" fill="url(#aqua)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M96 34C78 22 49 24 35 40C23 53 23 76 35 87" fill="none" stroke="#d6ffce" stroke-width="2" stroke-linecap="round"/>
    <path d="M38 95C56 111 84 108 99 91C111 78 111 58 101 47C104 69 91 84 78 87C65 91 52 87 45 82Z" fill="url(#green)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M45 97C62 105 80 101 92 91C103 82 106 69 104 60" fill="none" stroke="#edffc0" stroke-width="2" stroke-linecap="round"/>
    <path d="M58 100C58 78 61 61 68 46L74 47C67 64 66 80 67 101L63 108Z" fill="#429a47" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M60 77C43 79 31 68 34 55C49 51 62 60 64 70L65 78ZM66 66C65 51 76 42 94 43C97 56 84 70 66 71Z" fill="url(#green)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M39 59C47 61 55 65 61 72M89 48C82 51 75 58 69 65M42 68L47 63M51 74L54 67M81 60L80 54M72 65L75 58M62 89L63 99" fill="none" stroke="#d2ffae" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M70 51C58 51 50 41 55 32C65 28 74 34 75 41C79 33 87 33 92 38C91 49 81 55 70 51Z" fill="url(#green)" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M72 43C66 39 65 30 72 22C80 27 82 37 76 44Z" fill="#baf17e" stroke="#101820" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M59 36C64 36 69 40 72 46M87 39C82 40 78 44 76 47M73 28L74 37" fill="none" stroke="#efffd0" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M42 92C40 86 37 83 38 79C44 81 49 83 50 88C51 93 47 96 42 92ZM92 77C88 73 91 69 96 66C97 71 98 76 96 78C95 79 93 79 92 77Z" fill="#d3fbac" stroke="#306d42" stroke-width="1.5" stroke-linejoin="round"/>
    <path d="M31 39L25 36L29 30M94 33L101 34L99 41M44 105L38 109M90 104L94 108M19 72L23 72" fill="none" stroke="#d4ffe0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  `,
};
