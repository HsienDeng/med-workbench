import aiomysql.connection as ac
import pymysql.converters as c

print("pymysql escape_bytes_prefixed:", repr(c.escape_bytes_prefixed), type(c.escape_bytes_prefixed))
print("aiomysql imported:", repr(ac.escape_bytes_prefixed), type(ac.escape_bytes_prefixed))
