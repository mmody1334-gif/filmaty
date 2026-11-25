package app.filmaty.nativeapp

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage

val Ink = Color(0xFF0C0A08)
val Ink2 = Color(0xFF15110D)
val Ink3 = Color(0xFF1F1A14)
val Saffron = Color(0xFFF0A32B)
val Saffron2 = Color(0xFFFFC66B)
val Sand = Color(0xFFF3E9D8)
val Mute = Color(0xFFA99F8E)
val Line = Color(0x1FF3E9D8)

val Tajawal = FontFamily(
    Font(R.font.tajawal_regular, FontWeight.Normal),
    Font(R.font.tajawal_bold, FontWeight.Bold),
    Font(R.font.tajawal_extrabold, FontWeight.ExtraBold),
)
val Kufi = FontFamily(Font(R.font.reemkufi_bold, FontWeight.Bold))

fun t(size: Int, weight: FontWeight = FontWeight.Bold, color: Color = Sand, family: FontFamily = Tajawal) =
    TextStyle(fontFamily = family, fontSize = size.sp, fontWeight = weight, color = color)

@Composable
fun FilmatyTheme(content: @Composable () -> Unit) {
    MaterialTheme { content() }
}

fun img(path: String?, size: String): String? = path?.let { IMG + size + it }

@Composable
fun SectionTitle(text: String) {
    Row(
        Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.width(4.dp).height(22.dp).clip(RoundedCornerShape(2.dp)).background(Saffron))
        Spacer(Modifier.width(10.dp))
        Text(text, style = t(22, color = Sand, family = Kufi))
    }
}

@Composable
fun PosterCard(item: Item, width: Dp = 122.dp, onClick: () -> Unit) {
    Column(Modifier.width(width).clickable { onClick() }) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(16.dp))
                .background(Ink3)
                .border(BorderStroke(1.dp, Line), RoundedCornerShape(16.dp))
        ) {
            AsyncImage(
                model = img(item.poster, "w342"),
                contentDescription = item.title,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
            if (item.rating > 0) {
                Text(
                    "★ " + String.format("%.1f", item.rating),
                    style = t(11, FontWeight.ExtraBold, Saffron2),
                    modifier = Modifier.align(Alignment.TopStart).padding(6.dp)
                        .clip(RoundedCornerShape(8.dp)).background(Color(0xCC0C0A08))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(item.title, style = t(13), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            (if (item.type == "tv") "مسلسل" else "فيلم") + (if (item.year.isNotEmpty()) " · " + item.year else ""),
            style = t(11, FontWeight.Normal, Mute),
        )
    }
}

@Composable
fun PosterRow(title: String, list: List<Item>, onOpen: (Item) -> Unit) {
    if (list.isEmpty()) return
    SectionTitle(title)
    LazyRow(
        contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 18.dp),
        horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp),
    ) {
        items(list, key = { it.type + it.id }) { PosterCard(it) { onOpen(it) } }
    }
    Spacer(Modifier.height(8.dp))
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(54.dp).clip(RoundedCornerShape(16.dp)).background(Saffron).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) { Text(text, style = t(17, FontWeight.ExtraBold, Color(0xFF1B1206))) }
}

@Composable
fun GhostButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.height(54.dp).clip(RoundedCornerShape(16.dp)).background(Ink3)
            .border(BorderStroke(1.dp, Line), RoundedCornerShape(16.dp)).clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) { Text(text, style = t(16, FontWeight.ExtraBold)) }
}

@Composable
fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        Modifier.height(44.dp).clip(shape)
            .background(if (selected) Color(0x29F0A32B) else Color(0x0FF3E9D8))
            .border(BorderStroke(1.5.dp, if (selected) Saffron else Line), shape)
            .clickable { onClick() }.padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            (if (selected) "✓ " else "") + text,
            style = t(14, if (selected) FontWeight.ExtraBold else FontWeight.Bold, if (selected) Saffron2 else Sand),
        )
    }
}

@Composable
fun Scrim(modifier: Modifier = Modifier) {
    Box(
        modifier.background(
            Brush.verticalGradient(
                listOf(Color(0x000C0A08), Color(0x990C0A08), Ink)
            )
        )
    )
}

@Composable
fun Dot(on: Boolean) {
    Box(
        Modifier.padding(horizontal = 3.dp).height(6.dp).width(if (on) 22.dp else 6.dp)
            .clip(CircleShape).background(if (on) Saffron else Color(0x55F3E9D8))
    )
}
