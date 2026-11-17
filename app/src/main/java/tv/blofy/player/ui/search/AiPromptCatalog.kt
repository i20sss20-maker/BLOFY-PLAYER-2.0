package tv.blofy.player.ui.search

/**
 * Subscriber-facing ideas, not catalog facts. A suggestion is sent only after
 * the user clicks it; the AI resolver still verifies all returned titles.
 */
internal object AiPromptCatalog {
    data class Prompt(val ar: String, val en: String) {
        fun text(language: String): String = if (language == "en") en else ar
    }
    data class Group(val id: String, val ar: String, val en: String, val prompts: List<Prompt>) {
        fun label(language: String): String = if (language == "en") en else ar
    }

    val groups: List<Group> = listOf(
        Group("action", "أكشن وتشويق", "Action & thrills", listOf(
            Prompt("رشح لي أفلام أكشن قوية ومشوقة", "Recommend intense action movies"),
            Prompt("أبغى فيلم مطاردات سيارات ومغامرات", "Find a movie with car chases and adventure"),
            Prompt("أعطني فيلم عن الجواسيس والمهمات السرية", "Suggest a spy mission movie"),
            Prompt("رشح لي أفلام قتال وفنون قتالية", "Recommend martial arts movies"),
            Prompt("أبغى فيلم سرقة وتخطيط ذكي", "Find a clever heist movie"),
            Prompt("اقترح فيلم بقاء على قيد الحياة", "Recommend survival movies")
        )),
        Group("comedy", "كوميديا وضحك", "Comedy", listOf(
            Prompt("أبي فيلم كوميدي يضحكني من البداية للنهاية", "I want a hilarious comedy movie"),
            Prompt("رشح لي كوميديا للكبار", "Recommend adult comedy movies"),
            Prompt("أبغى كوميديا رومانسية خفيفة", "Suggest a light romantic comedy"),
            Prompt("اقترح فيلم كوميدي جديد", "Suggest a recent comedy film"),
            Prompt("أبي فيلم كوميدي عن الأصدقاء والمغامرات", "Find a buddy adventure comedy"),
            Prompt("رشح لي مسلسلات كوميدية قصيرة", "Recommend short comedy series")
        )),
        Group("suspense", "غموض ورعب", "Mystery & horror", listOf(
            Prompt("رشح لي أفلام رعب قوية", "Recommend scary horror movies"),
            Prompt("أبي فيلم غموض بنهاية غير متوقعة", "Find a mystery movie with a twist ending"),
            Prompt("أبغى مسلسل تحقيقات وجرائم", "Recommend a crime investigation series"),
            Prompt("اقترح فيلم إثارة نفسية", "Recommend a psychological thriller movie"),
            Prompt("أبي فيلم زومبي أو نهاية العالم", "Find a zombie or apocalypse movie"),
            Prompt("رشح لي مسلسل غموض وتشويق", "Recommend a suspenseful mystery series")
        )),
        Group("series", "مسلسلات ومواسم", "Series & seasons", listOf(
            Prompt("أبي مسلسل جديد يستاهل المتابعة", "Recommend a new series worth watching"),
            Prompt("رشح لي مسلسل قصير أخلصه في يومين", "Find a short series I can finish in two days"),
            Prompt("أبغى مسلسل أكشن بمواسم كثيرة", "Recommend a multi-season action series"),
            Prompt("رشح لي مسلسل درامي قوي", "Suggest an emotional drama series"),
            Prompt("أبي مسلسل فيه مفاجآت وحبكة ذكية", "Find a series with clever plot twists"),
            Prompt("اقترح مسلسل تاريخي ممتع", "Recommend an entertaining historical series")
        )),
        Group("family", "عائلة وأنيميشن", "Family & animation", listOf(
            Prompt("رشح لي فيلم مناسب للعائلة", "Recommend a family-friendly movie"),
            Prompt("أبي أفلام أنيميشن ممتعة", "Suggest entertaining animated movies"),
            Prompt("رشح لي فيلم مغامرات عائلي", "Find a family adventure movie"),
            Prompt("أبغى أفلام كرتون مضحكة", "Recommend funny animated films"),
            Prompt("اقترح مسلسل أنيميشن ممتع", "Suggest a fun animated series"),
            Prompt("رشح لي فيلم خيال يناسب المشاهدة العائلية", "Find a fantasy movie for family viewing")
        )),
        Group("arabic", "عربي وخليجي", "Arabic & Gulf", listOf(
            Prompt("رشح لي أفلام سعودية جديدة", "Recommend recent Saudi movies"),
            Prompt("أبي مسلسل خليجي اجتماعي", "Find a Gulf social drama series"),
            Prompt("اقترح كوميديا مصرية ممتعة", "Recommend Egyptian comedy movies"),
            Prompt("أبغى مسلسل عربي تشويقي", "Suggest an Arabic suspense series"),
            Prompt("رشح لي فيلم عربي قديم", "Recommend a classic Arabic movie"),
            Prompt("أبي مسلسلات سعودية كوميدية", "Recommend Saudi comedy series")
        )),
        Group("world", "عالمي ومتنوّع", "International", listOf(
            Prompt("رشح لي أفلام كورية مشوقة", "Recommend exciting Korean movies"),
            Prompt("أبي مسلسل تركي درامي", "Recommend a Turkish drama series"),
            Prompt("اقترح فيلم هندي أكشن", "Find an Indian action movie"),
            Prompt("رشح لي مسلسل إسباني جريمة", "Recommend a Spanish crime series"),
            Prompt("أبغى فيلم أوروبي غموض", "Suggest a European mystery movie"),
            Prompt("رشح لي أفلام يابانية أنيميشن", "Recommend Japanese animated movies")
        )),
        Group("moods", "حسب المزاج", "By mood", listOf(
            Prompt("طفشان، وش أشوف الليلة؟", "I'm bored. What should I watch tonight?"),
            Prompt("أبي فيلم خفيف ما يحتاج تركيز", "Suggest a relaxing easy-to-watch movie"),
            Prompt("أبغى فيلم حزين ومؤثر", "Find an emotional tearjerker movie"),
            Prompt("رشح لي فيلم حماسي يحبس الأنفاس", "Recommend an edge-of-your-seat movie"),
            Prompt("أبي فيلم رومانسي دافئ", "Suggest a heartwarming romance movie"),
            Prompt("اقترح فيلم يرفع المعنويات", "Recommend an uplifting movie")
        )),
        Group("discovery", "جديد وكلاسيكيات", "New & classics", listOf(
            Prompt("وش أحدث أفلام الأكشن عندي؟", "What recent action films are in my catalog?"),
            Prompt("رشح لي أفلام من سنة 2024", "Recommend movies from 2024"),
            Prompt("أبغى أفلام التسعينات الكلاسيكية", "Recommend classic 1990s movies"),
            Prompt("اقترح أفلام خيال علمي", "Suggest science fiction movies"),
            Prompt("رشح لي أفلام مقتبسة من قصة حقيقية", "Recommend movies based on true stories"),
            Prompt("أبي أفلام حاصلة على تقييم عالي", "Suggest highly rated movies")
        )),
        Group("lookup", "أسماء وممثلين", "Titles & actors", listOf(
            Prompt("ابحث لي عن فيلم باسم أكتبه لك", "Help me find a movie by its title"),
            Prompt("أبغى أعمال ممثل مشهور", "Show movies starring a famous actor"),
            Prompt("رشح لي أفلام بطولة توم كروز", "Recommend movies starring Tom Cruise"),
            Prompt("رشح لي أفلام بطولة أحمد حلمي", "Find movies starring Ahmed Helmy"),
            Prompt("أبي مسلسلات فيها ممثلين معروفين", "Suggest series with well-known actors"),
            Prompt("إذا ما لقيت الفيلم اقترح لي شيء مشابه", "If a title is missing, suggest a similar movie")
        ))
    )
}
