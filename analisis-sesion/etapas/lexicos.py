"""
Léxicos de marcadores retóricos (exploratorios, editables).

Cada categoría es una lista de palabras o frases en minúscula. Se cuentan por
cada 1.000 palabras del orador para poder comparar oradores que hablan más o
menos tiempo.

IMPORTANTE: estos léxicos son una operacionalización de autor, no un detector
validado. Que alguien use muchos "absolutos" o "amenaza" no prueba manipulación:
es un rasgo del discurso que el análisis vuelve visible. Conviene revisarlos,
ampliarlos y declararlos como decisión metodológica en la tesis.
"""

MARCADORES = {
    # Generalización absoluta: borra matices y excepciones
    "absolutos": [
        "siempre", "nunca", "jamás", "todos", "todas", "nadie", "nada",
        "ninguno", "ninguna", "ningún", "totalmente", "absolutamente",
        "completamente", "sin excepción", "de ninguna manera", "en ningún caso",
        "cien por ciento",
    ],
    # Construcción de un "nosotros" (pertenencia, pueblo, familias)
    "nosotros": [
        "nosotros", "nosotras", "nuestro", "nuestra", "nuestros", "nuestras",
        "los chilenos", "las chilenas", "chilenos y chilenas", "el pueblo",
        "la gente", "las familias", "la ciudadanía", "los vecinos",
        "el país", "la patria",
    ],
    # Construcción de un "ellos" (adversario, otredad)
    "ellos": [
        "ellos", "ellas", "el gobierno", "la oposición", "la izquierda",
        "la derecha", "el oficialismo", "algunos", "esos", "aquellos",
        "los mismos de siempre", "la élite", "los poderosos", "los de siempre",
    ],
    # Léxico de amenaza, miedo o crisis
    "amenaza": [
        "crisis", "amenaza", "amenazas", "peligro", "peligroso", "riesgo",
        "miedo", "temor", "inseguridad", "delincuencia", "delincuentes",
        "crimen", "criminales", "violencia", "caos", "colapso", "destrucción",
        "emergencia", "catástrofe", "terror", "terrorismo", "terroristas",
        "narcotráfico", "desastre", "abismo", "alarma", "alarmante", "grave",
        "gravísimo", "invasión", "descontrol",
    ],
    # Atenuadores: expresan duda o cautela
    "atenuadores": [
        "quizás", "quizá", "tal vez", "posiblemente", "probablemente",
        "parece", "pareciera", "podría", "podríamos", "creo", "pienso",
        "entiendo", "eventualmente", "en cierta medida", "de alguna manera",
        "aparentemente", "me parece", "a mi juicio",
    ],
    # Intensificadores y certeza enfática
    "intensificadores": [
        "muy", "realmente", "verdaderamente", "extremadamente", "enormemente",
        "profundamente", "tremendamente", "sumamente", "clarísimo",
        "evidentemente", "obviamente", "sin duda", "sin lugar a dudas",
        "indudablemente", "claramente", "absolutamente",
    ],
    # Apelación a una verdad dada por sentada (evidencialidad sin fuente)
    "verdad_dada": [
        "está demostrado", "es un hecho", "la realidad es", "lo cierto es",
        "la verdad es", "todos sabemos", "es evidente", "como todos saben",
        "nadie puede negar", "no hay duda", "es obvio", "lo que está claro",
    ],
    # Léxico moral
    "moral": [
        "justicia", "injusticia", "injusto", "dignidad", "vergüenza",
        "vergonzoso", "abuso", "abusos", "derechos", "libertad", "corrupción",
        "honestidad", "responsabilidad", "irresponsable", "traición", "deber",
        "ética", "inmoral",
    ],
    # Apoyo en datos o fuentes (se suman además las cifras detectadas)
    "datos_fuentes": [
        "según", "de acuerdo con", "de acuerdo a", "cifras", "datos",
        "estudio", "estudios", "informe", "estadística", "estadísticas",
        "por ciento", "millones", "encuesta", "fuente",
    ],
    # Primera persona singular (autoridad personal)
    "yo": ["yo", "mí", "mi", "mis", "me"],
    "negacion": ["no", "ni", "tampoco"],
}
