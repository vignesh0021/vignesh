package com.loadshare.areaalert.model

enum class DeliveryPlatform(val displayName: String) {
    LOADSHARE("Loadshare"),
    ZOMATO("Zomato"),
    SWIGGY("Swiggy"),
    RAPIDO("Rapido"),
    PORTER("Porter"),
    SHADOWFAX("Shadowfax"),
    DUNZO("Dunzo"),
    BORZO("Borzo"),
    DELHIVERY("Delhivery"),
    ECOM_EXPRESS("Ecom Express"),
    BLINKIT("Blinkit"),
    ZEPTO("Zepto"),
    BIGBASKET("BigBasket"),
    GENERIC("Delivery App");

    companion object {
        fun fromPackageName(packageName: String): DeliveryPlatform {
            val pkg = packageName.lowercase()
            return when {
                "loadshare" in pkg -> LOADSHARE
                "zomato" in pkg -> ZOMATO
                "swiggy" in pkg -> SWIGGY
                "rapido" in pkg -> RAPIDO
                "porter" in pkg -> PORTER
                "shadowfax" in pkg -> SHADOWFAX
                "dunzo" in pkg -> DUNZO
                "borzo" in pkg || "wolt" in pkg -> BORZO
                "delhivery" in pkg -> DELHIVERY
                "ecom" in pkg -> ECOM_EXPRESS
                "blinkit" in pkg || "grofers" in pkg -> BLINKIT
                "zepto" in pkg -> ZEPTO
                "bigbasket" in pkg -> BIGBASKET
                else -> GENERIC
            }
        }
    }
}
