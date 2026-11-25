package app.filmaty.nativeapp

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.runtime.CompositionLocalProvider
import coil.compose.AsyncImage
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay

sealed class Screen {
    object Home : Screen()
    data class Details(val item: Item) : Screen()
    data class Player(val item: Item, val season: Int, val episode: Int) : Screen()
}

class HomeData(
    val hero: List<Item>,
    val rows: List<Pair<String, List<Item>>>,
)

object Cache {
    var home: HomeData? = null
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                FilmatyTheme { FilmatyApp() }
            }
        }
    }
}

@Composable
fun FilmatyApp() {
    var stack by remember { mutableStateOf(listOf<Screen>(Screen.Home)) }
    val listState = rememberLazyListState()
    BackHandler(enabled = stack.size > 1) { stack = stack.dropLast(1) }
    Box(Modifier.fillMaxSize().background(Ink)) {
        when (val s = stack.last()) {
            is Screen.Home -> HomeScreen(listState) { item -> stack = stack + Screen.Details(item) }
            is Screen.Details -> DetailsScreen(
                base = s.item,
                onBack = { stack = stack.dropLast(1) },
                onOpen = { stack = stack + Screen.Details(it) },
                onPlay = { sn, ep -> stack = stack + Screen.Player(s.item, sn, ep) },
            )
            is Screen.Player -> PlayerScreen(s.item, s.season, s.episode) { stack = stack.dropLast(1) }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HomeScreen(listState: LazyListState, onOpen: (Item) -> Unit) {
    var data by remember { mutableStateOf(Cache.home) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (data == null) {
            val d = coroutineScope {
                val h = async { Api.row("/trending/all/week", "movie") }
                val a = async { Api.row("/trending/movie/week", "movie") }
                val b = async { Api.row("/trending/tv/week", "tv") }
                val c = async { Api.row("/movie/top_rated", "movie") }
                val e = async { Api.row("/tv/top_rated", "tv") }
                val f = async { Api.row("/movie/now_playing", "movie") }
                val g = async { Api.row("/tv/popular", "tv") }
                HomeData(
                    h.await().filter { it.backdrop != null }.take(6),
                    listOf(
                        "أفلام رائجة" to a.await(),
                        "مسلسلات رائجة" to b.await(),
                        "الأعلى تقييمًا" to c.await(),
                        "في السينما الآن" to f.await(),
                        "مسلسلات مشهورة" to g.await(),
                        "مسلسلات الأعلى تقييمًا" to e.await(),
                    ).filter { it.second.isNotEmpty() },
                )
            }
            if (d.hero.isEmpty() && d.rows.isEmpty()) failed = true else {
                Cache.home = d
                data = d
            }
        }
    }
    val d = data
    if (d == null) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text(if (failed) "تعذر تحميل المحتوى. تأكد من الاتصال." else "جاري التحميل...", style = t(16, color = Mute))
        }
        return
    }
    val pager = rememberPagerState(pageCount = { d.hero.size.coerceAtLeast(1) })
    LaunchedEffect(d.hero.size) {
        while (d.hero.size > 1) {
            delay(6500)
            pager.animateScrollToPage((pager.currentPage + 1) % d.hero.size)
        }
    }
    val current = d.hero.getOrNull(pager.currentPage)
    Box(Modifier.fillMaxSize()) {
        Crossfade(targetState = current?.backdrop, label = "bg") { b ->
            AsyncImage(
                model = img(b, "w780"),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().alpha(0.38f),
            )
        }
        Scrim(Modifier.fillMaxSize())
        LazyColumn(state = listState, contentPadding = PaddingValues(bottom = 40.dp), modifier = Modifier.fillMaxSize()) {
            item {
                Row(
                    Modifier.statusBarsPadding().padding(horizontal = 18.dp, vertical = 12.dp).fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("فيلماتي", style = t(30, color = Saffron, family = Kufi))
                }
            }
            if (d.hero.isNotEmpty()) item {
                Column {
                    HorizontalPager(state = pager, contentPadding = PaddingValues(horizontal = 14.dp), pageSpacing = 12.dp) { i ->
                        HeroCard(d.hero[i], onOpen)
                    }
                    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.Center) {
                        for (i in d.hero.indices) Dot(i == pager.currentPage)
                    }
                    Spacer(Modifier.height(10.dp))
                }
            }
            for ((title, list) in d.rows) item(key = title) { PosterRow(title, list, onOpen) }
        }
    }
}

@Composable
fun HeroCard(item: Item, onOpen: (Item) -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(430.dp).clip(RoundedCornerShape(26.dp)).background(Ink3)
            .clickable { onOpen(item) }
    ) {
        AsyncImage(
            model = img(item.poster ?: item.backdrop, "w780"),
            contentDescription = item.title,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        Scrim(Modifier.fillMaxSize())
        Column(Modifier.align(Alignment.BottomStart).padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    "مختارات فيلماتي",
                    style = t(12, FontWeight.ExtraBold, Color(0xFF1B1206)),
                    modifier = Modifier.clip(RoundedCornerShape(99.dp)).background(Saffron).padding(horizontal = 10.dp, vertical = 3.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    (if (item.type == "tv") "مسلسل" else "فيلم") + " · " + item.year + "  ★ " + String.format("%.1f", item.rating),
                    style = t(13, color = Sand),
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(item.title, style = t(34, color = Color.White, family = Kufi), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(6.dp))
            Text(item.overview, style = t(14, FontWeight.Normal, Color(0xFFD9CFBD)), maxLines = 3, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(14.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryButton("▶ شاهد الآن", Modifier.weight(1f)) { onOpen(item) }
                GhostButton("التفاصيل", Modifier.weight(1f)) { onOpen(item) }
            }
        }
    }
}

@Composable
fun DetailsScreen(
    base: Item,
    onBack: () -> Unit,
    onOpen: (Item) -> Unit,
    onPlay: (Int, Int) -> Unit,
) {
    var detail by remember(base.id) { mutableStateOf<Detail?>(null) }
    var season by remember(base.id) { mutableStateOf(1) }
    var episodes by remember(base.id) { mutableStateOf(1) }
    LaunchedEffect(base.id) { detail = Api.detail(base.type, base.id) }
    LaunchedEffect(base.id, season) {
        if (base.type == "tv") episodes = Api.episodeCount(base.id, season).coerceAtLeast(1)
    }
    val d = detail
    val it0 = d?.item ?: base
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            Box(Modifier.fillMaxWidth().height(330.dp)) {
                AsyncImage(
                    model = img(it0.backdrop ?: it0.poster, "w1280"),
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                Scrim(Modifier.fillMaxSize())
                Text(
                    "→ رجوع",
                    style = t(15),
                    modifier = Modifier.statusBarsPadding().padding(14.dp).clip(RoundedCornerShape(14.dp))
                        .background(Color(0xAA0C0A08)).clickable { onBack() }.padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }
        }
        item {
            Column(Modifier.padding(horizontal = 18.dp)) {
                Text(it0.title, style = t(32, color = Color.White, family = Kufi))
                Spacer(Modifier.height(6.dp))
                val meta = buildList {
                    add(if (it0.type == "tv") "مسلسل" else "فيلم")
                    if (it0.year.isNotEmpty()) add(it0.year)
                    if (it0.rating > 0) add("★ " + String.format("%.1f", it0.rating))
                    if (d != null && d.runtime > 0) add(d.runtime.toString() + " د")
                    if (d != null && it0.type == "tv") add(d.seasons.toString() + " مواسم")
                }
                Text(meta.joinToString("  ·  "), style = t(14, color = Saffron2))
                if (d != null && d.genres.isNotEmpty()) {
                    Spacer(Modifier.height(4.dp))
                    Text(d.genres.joinToString("، "), style = t(13, FontWeight.Normal, Mute))
                }
                Spacer(Modifier.height(14.dp))
                Text(it0.overview, style = t(15, FontWeight.Normal, Color(0xFFD9CFBD)))
                Spacer(Modifier.height(18.dp))
                PrimaryButton(
                    if (it0.type == "tv") "▶ شاهد الحلقة الأولى" else "▶ شاهد الآن",
                    Modifier.fillMaxWidth(),
                ) { onPlay(season, 1) }
            }
        }
        if (base.type == "tv" && d != null) {
            item {
                SectionTitle("الموسم")
                LazyRow(contentPadding = PaddingValues(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items((1..d.seasons.coerceAtLeast(1)).toList()) { n -> Chip("موسم $n", n == season) { season = n } }
                }
                SectionTitle("الحلقات")
                LazyRow(contentPadding = PaddingValues(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items((1..episodes).toList()) { n -> Chip("حلقة $n", false) { onPlay(season, n) } }
                }
            }
        }
        if (d != null && d.cast.isNotEmpty()) item {
            SectionTitle("طاقم التمثيل")
            LazyRow(contentPadding = PaddingValues(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                items(d.cast) { c ->
                    Column(Modifier.width(84.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        AsyncImage(
                            model = img(c.photo, "w185"),
                            contentDescription = c.name,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(72.dp).clip(CircleShape).background(Ink3),
                        )
                        Spacer(Modifier.height(6.dp))
                        Text(c.name, style = t(12), maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(c.role, style = t(11, FontWeight.Normal, Mute), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        if (d != null && d.similar.isNotEmpty()) item { PosterRow("أعمال شبه ده", d.similar, onOpen) }
    }
}


@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PlayerScreen(item: Item, season: Int, episode: Int, onBack: () -> Unit) {
    val servers = remember(item.id, season, episode) { embedServers(item.type, item.id, season, episode) }
    var sel by remember { mutableStateOf(0) }
    val ctx = LocalContext.current
    var customView by remember { mutableStateOf<View?>(null) }
    var customCb by remember { mutableStateOf<WebChromeClient.CustomViewCallback?>(null) }
    BackHandler(enabled = customView != null) { customCb?.onCustomViewHidden() }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "→ رجوع",
                style = t(15),
                modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(Ink3).clickable { onBack() }
                    .padding(horizontal = 16.dp, vertical = 10.dp),
            )
            Spacer(Modifier.width(12.dp))
            Text(
                item.title + if (item.type == "tv") " · م$season ح$episode" else "",
                style = t(16),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f).background(Color.Black)) {
            key(sel, servers) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { c ->
                        WebView(c).apply {
                            setBackgroundColor(android.graphics.Color.BLACK)
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.mediaPlaybackRequiresUserGesture = false
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                            webViewClient = WebViewClient()
                            webChromeClient = object : WebChromeClient() {
                                override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                                    customView = view
                                    customCb = callback
                                    val act = c as? Activity
                                    (act?.window?.decorView as? ViewGroup)?.addView(
                                        view,
                                        FrameLayout.LayoutParams(-1, -1),
                                    )
                                }

                                override fun onHideCustomView() {
                                    val act = c as? Activity
                                    customView?.let { (act?.window?.decorView as? ViewGroup)?.removeView(it) }
                                    customView = null
                                    customCb = null
                                }
                            }
                            val url = servers[sel].second
                            val html = "<html><body style='margin:0;background:#000'><iframe src='" + url +
                                "' style='border:0;width:100vw;height:100vh' allowfullscreen " +
                                "allow='autoplay; fullscreen; encrypted-media; picture-in-picture' " +
                                "sandbox='allow-scripts allow-same-origin allow-forms allow-presentation'></iframe></body></html>"
                            loadDataWithBaseURL(BASE, html, "text/html", "utf-8", null)
                        }
                    },
                    onRelease = { it.destroy() },
                )
            }
        }
        Spacer(Modifier.height(14.dp))
        Text("السيرفر", style = t(16), modifier = Modifier.padding(horizontal = 18.dp))
        Spacer(Modifier.height(8.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(servers.indices.toList()) { i -> Chip(servers[i].first, i == sel) { sel = i } }
        }
        Spacer(Modifier.height(14.dp))
        Text(
            "لو السيرفر مش شغال جرّب سيرفر تاني.",
            style = t(13, FontWeight.Normal, Mute),
            modifier = Modifier.padding(horizontal = 18.dp),
        )
    }
}
