package app.filmaty.nativeapp

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

const val BASE = "https://filmaty.hudhaifa-bio.workers.dev"
const val IMG = "https://image.tmdb.org/t/p/"

data class Item(
    val id: Int,
    val type: String,
    val title: String,
    val overview: String,
    val poster: String?,
    val backdrop: String?,
    val year: String,
    val rating: Double,
)

data class Cast(val name: String, val role: String, val photo: String?)

data class Detail(
    val item: Item,
    val genres: List<String>,
    val runtime: Int,
    val seasons: Int,
    val cast: List<Cast>,
    val similar: List<Item>,
)

object Api {
    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    suspend fun tmdb(path: String, append: String? = null, extra: String = ""): JSONObject? =
        withContext(Dispatchers.IO) {
            try {
                var u = "$BASE/api/tmdb?path=${enc(path)}&lang=ar"
                if (append != null) u += "&append=${enc(append)}"
                val c = URL(u).openConnection() as HttpURLConnection
                c.connectTimeout = 15000
                c.readTimeout = 25000
                if (c.responseCode != 200) null else JSONObject(c.inputStream.bufferedReader().readText())
            } catch (e: Exception) {
                null
            }
        }

    fun parseItems(arr: JSONArray?, defType: String): List<Item> {
        if (arr == null) return emptyList()
        val out = ArrayList<Item>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val type = o.optString("media_type", defType).ifEmpty { defType }
            if (type != "movie" && type != "tv") continue
            val title = o.optString("title", "").ifEmpty { o.optString("name", "") }
            if (title.isEmpty()) continue
            val date = o.optString("release_date", "").ifEmpty { o.optString("first_air_date", "") }
            out.add(
                Item(
                    id = o.optInt("id"),
                    type = type,
                    title = title,
                    overview = o.optString("overview", ""),
                    poster = o.optString("poster_path", "").takeIf { it.isNotEmpty() && it != "null" },
                    backdrop = o.optString("backdrop_path", "").takeIf { it.isNotEmpty() && it != "null" },
                    year = date.take(4),
                    rating = o.optDouble("vote_average", 0.0),
                )
            )
        }
        return out
    }

    suspend fun row(path: String, defType: String): List<Item> =
        parseItems(tmdb(path)?.optJSONArray("results"), defType)

    suspend fun detail(type: String, id: Int): Detail? {
        val o = tmdb("/$type/$id", append = "credits,similar") ?: return null
        val item = parseItems(JSONArray().put(o.put("media_type", type)), type).firstOrNull() ?: return null
        val gs = ArrayList<String>()
        o.optJSONArray("genres")?.let { for (i in 0 until it.length()) gs.add(it.getJSONObject(i).optString("name")) }
        val cast = ArrayList<Cast>()
        o.optJSONObject("credits")?.optJSONArray("cast")?.let {
            for (i in 0 until minOf(it.length(), 14)) {
                val c = it.getJSONObject(i)
                cast.add(
                    Cast(
                        c.optString("name"),
                        c.optString("character"),
                        c.optString("profile_path", "").takeIf { p -> p.isNotEmpty() && p != "null" },
                    )
                )
            }
        }
        val sim = parseItems(o.optJSONObject("similar")?.optJSONArray("results"), type)
        val rt = o.optInt("runtime", 0).let { if (it == 0) o.optJSONArray("episode_run_time")?.optInt(0, 0) ?: 0 else it }
        return Detail(item, gs, rt, o.optInt("number_of_seasons", 1), cast, sim)
    }

    suspend fun episodeCount(id: Int, season: Int): Int =
        tmdb("/tv/$id/season/$season")?.optJSONArray("episodes")?.length() ?: 1
}

fun embedServers(type: String, id: Int, s: Int, e: Int): List<Pair<String, String>> {
    val tv = type == "tv"
    return listOf(
        "embedwave" to if (tv) "https://embedwave.cc/embed/tv/$id/$s/$e" else "https://embedwave.cc/embed/movie/$id",
        "2embed" to if (tv) "https://www.2embed.cc/embedtv/$id&s=$s&e=$e" else "https://www.2embed.cc/embed/$id",
        "2embed-2" to if (tv) "https://www.2embed.skin/embedtv/$id&s=$s&e=$e" else "https://www.2embed.skin/embed/$id",
    )
}
